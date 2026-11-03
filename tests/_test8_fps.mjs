// 测帧时间：朝不同方向看时是否掉帧；以及点火后（多出点光源）的影响
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

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(600);

// 页面内安装帧时间记录器
await ev(`(() => {
  window.__ft = [];
  let last = performance.now();
  const loop = (t) => {
    window.__ft.push(t - last);
    last = t;
    if (window.__ft.length > 4000) window.__ft.shift();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})()`);

const measure = async (label) => {
  await sleep(200);
  await ev(`window.__ft = []`);
  await sleep(800);
  const ft = JSON.parse((await ev(`JSON.stringify(window.__ft)`)).value || "[]").slice(1);
  if (!ft.length) return console.log(label, "无采样");
  const sorted = [...ft].sort((a, b) => a - b);
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const max = sorted[sorted.length - 1];
  console.log(
    `${label}: ${ft.length} 帧 | 平均 ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(0)} FPS) | ` +
    `P95 ${p95.toFixed(1)}ms | 最差 ${max.toFixed(1)}ms`
  );
};

console.log("=== 静止在不同朝向 ===");
for (const [yaw, name] of [[0, "看房间内侧"], [Math.PI, "回头看门"], [Math.PI / 2, "看水槽方向"], [-Math.PI / 2, "看沙发/电视"]]) {
  await ev(`(() => { const g = window.__game; g.player.yaw = ${yaw}; g.player.pos.set(0, g.TUNE.eyeHeight, 2.0); })()`);
  await measure(name);
}

console.log("\n=== 移动中 ===");
await ev(`(() => { const g = window.__game; g.player.yaw = 0; g.player.pos.set(0, g.TUNE.eyeHeight, 3.0); })()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87, text: "w" });
await measure("按住 W 前进");
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });

console.log("\n=== 火焰开启后（每团火带一个点光源）===");
await ev(`(() => {
  const g = window.__game;
  const before = { ratio: g.__rendererRatio || null };
  for (let i = 0; i < 4; i++) {
    g.spawnParcel();
  }
  return JSON.stringify(before);
})()`);
await sleep(1800);
const lit = await ev(`(() => {
  const g = window.__game;
  let n = 0;
  for (const b of g.boxes) {
    if (n >= 4) break;
    b.group.position.x = -2 + n * 1.2;
    b.group.position.z = -1;
    b.y = b.size.y / 2;
    g.openBox(b);
    g.startBurning(b);
    n++;
  }
  return g.fires.length;
})()`);
console.log("已点燃火堆数量:", lit.value);
await ev(`(() => { window.__game.player.pos.set(0, window.__game.TUNE.eyeHeight, 2.6); window.__game.player.yaw = 0; })()`);
await measure("4 团火 + 4 个点光源");
const info = await ev(`(() => {
  const c = document.querySelector('canvas');
  return JSON.stringify({ canvasW: c.width, canvasH: c.height, dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight });
})()`);
console.log("画布信息:", info.value);

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
