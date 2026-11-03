// 逐帧采样玩家位置，定位"移动时画面抖动"
const PORT = process.argv[2] || "9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/i.test(t.url));
if (!page) throw new Error("no game page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return { value: r.result?.result?.value };
};
const keyDown = (k, code, vk) => send("Input.dispatchKeyEvent", {
  type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k,
});
const keyUp = (k, code, vk) => send("Input.dispatchKeyEvent", {
  type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
});

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(600);

const cases = [
  { name: "朝 -Z 前进", yaw: 0, pos: [0, 3.0], key: ["w", "KeyW", 87] },
  { name: "朝 +Z 前进", yaw: Math.PI, pos: [0, 0.0], key: ["w", "KeyW", 87] },
  { name: "朝 -X 前进", yaw: Math.PI / 2, pos: [2.5, 2.5], key: ["w", "KeyW", 87] },
  { name: "朝 +X 前进", yaw: -Math.PI / 2, pos: [-2.5, 2.5], key: ["w", "KeyW", 87] },
  { name: "朝 -Z 侧移 D", yaw: 0, pos: [0, 3.0], key: ["d", "KeyD", 68] },
];

for (const c of cases) {
  await ev(`(() => {
    const g = window.__game;
    g.player.pos.set(${c.pos[0]}, g.TUNE.eyeHeight, ${c.pos[1]});
    g.player.yaw = ${c.yaw};
    g.player.vy = 0;
    window.__rec = [];
    if (!window.__recOn) {
      window.__recOn = true;
      const loop = () => {
        const p = window.__game.player.pos;
        window.__rec.push([p.x, p.y, p.z]);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  })()`);
  await sleep(150);
  await ev(`window.__rec = []`);
  await keyDown(...c.key);
  await sleep(900);
  await keyUp(...c.key);
  await sleep(150);

  const rec = JSON.parse((await ev(`JSON.stringify(window.__rec)`)).value || "[]");
  if (rec.length < 15) {
    console.log(`${c.name}: 采样不足 (${rec.length} 帧)`);
    continue;
  }

  const step = [];
  for (let i = 1; i < rec.length; i++) {
    step.push([rec[i][0] - rec[i - 1][0], rec[i][2] - rec[i - 1][2]]);
  }
  const mags = step.map((d) => Math.hypot(d[0], d[1]));
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const max = Math.max(...mags);
  const zeroFrames = mags.filter((m) => m < 1e-5).length;

  const sumX = step.reduce((a, d) => a + d[0], 0);
  const sumZ = step.reduce((a, d) => a + d[1], 0);
  const axis = Math.abs(sumX) >= Math.abs(sumZ) ? 0 : 1;
  const sign = Math.sign((axis === 0 ? sumX : sumZ) || 1);
  let reversals = 0;
  for (const d of step) if (d[axis] * sign < -1e-4) reversals++;

  // 垂直抖动：y 的帧间变化
  const ys = rec.map((r) => r[1]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  console.log(
    `${c.name}: ${rec.length} 帧 | 步长 均 ${mean.toFixed(4)} 峰 ${max.toFixed(4)} ` +
    `(峰/均 ${(max / (mean || 1)).toFixed(2)}) | 静止帧 ${zeroFrames} | 反向帧 ${reversals} | y 幅度 ${(yMax - yMin).toFixed(3)}`
  );
}

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
