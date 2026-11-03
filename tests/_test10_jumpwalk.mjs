// 边跑边跳：起跳期间是否保持水平移动
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

// 在页面里逐帧记录，标记是否在空中
await ev(`(() => {
  window.__tr = [];
  const g = window.__game;
  const loop = () => {
    const p = g.player.pos;
    window.__tr.push([+p.x.toFixed(3), +(p.y - g.TUNE.eyeHeight).toFixed(3), +p.z.toFixed(3), g.player.onGround ? 1 : 0]);
    if (window.__tr.length < 400) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})()`);

// 场景：站在空地，先走动，然后在走动中按空格
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight, 3.4); g.player.feet = 0; g.player.feet = 0;
  g.player.yaw = 0;
  g.player.vy = 0;
  window.__tr = [];
})()`);
await sleep(200);

await keyDown("w", "KeyW", 87);      // 先跑起来
await sleep(350);
const zBeforeJump = +(await ev(`window.__game.player.pos.z.toFixed(2)`)).value;
await keyDown(" ", "Space", 32);      // 跑动中起跳
await keyUp(" ", "Space", 32);
await sleep(300);
const midJump = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ z: +g.player.pos.z.toFixed(2), feet: +(g.player.pos.y - g.TUNE.eyeHeight).toFixed(2), onGround: g.player.onGround });
})()`)).value);
await sleep(400);
await keyUp("w", "KeyW", 87);
await sleep(600);

const tr = JSON.parse((await ev(`JSON.stringify(window.__tr)`)).value || "[]");
// 找出一段连续的空中帧，统计这段时间的水平位移
let airStart = -1;
let airEnd = -1;
for (let i = 0; i < tr.length; i++) {
  if (tr[i][3] === 0 && airStart === -1) airStart = i;
  if (airStart !== -1 && tr[i][3] === 1 && airEnd === -1 && i > airStart + 2) { airEnd = i; break; }
}
let airDist = null;
if (airStart >= 0 && airEnd > airStart) {
  const a = tr[airStart];
  const b = tr[airEnd];
  airDist = Math.hypot(b[0] - a[0], b[2] - a[2]);
}

console.log(`跑动中起跳前 z=${zBeforeJump}`);
console.log(`起跳 0.3 秒后：${JSON.stringify(midJump)}`);
console.log(`空中帧 ${airStart}→${airEnd}，期间水平位移 ${airDist === null ? "无法统计" : airDist.toFixed(2) + " 米"}`);

let fail = 0;
if (!(midJump.feet > 0.2)) { console.log("FAIL 跑动中按空格没有离地"); fail++; } else console.log("OK   跑动中可以起跳");
if (airDist === null || airDist < 0.35) { console.log("FAIL 空中几乎没有水平位移（走和跳互相打断）"); fail++; }
else console.log("OK   空中保持前进");

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
