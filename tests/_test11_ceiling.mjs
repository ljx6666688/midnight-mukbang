// 验证：站在桌上再跳，镜头不会穿出屋顶
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

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

const roomH = +(await ev(`window.__game.TUNE ? 1 : 1`)).value;  // 占位
const info = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ wallH: 3.8 });
})()`)).value);

// 站到桌面上（feet=0.86），连续起跳，记录相机最高点
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight + 0.86, 0.4);
  g.player.feet = 0.86;
  g.player.vy = 0;
  window.__maxEye = 0;
  const loop = () => {
    window.__maxEye = Math.max(window.__maxEye, g.player.pos.y);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})()`);
await sleep(300);
for (let i = 0; i < 3; i++) {
  await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
  await sleep(500);
}
const peak = +(await ev(`window.__maxEye.toFixed(2)`)).value;

// 从水槽台(1.04)上起跳更高，也测一下
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(-4.1, g.TUNE.eyeHeight + 1.04, 0.6);
  g.player.feet = 1.04;
  g.player.vy = 0;
  window.__maxEye = 0;
})()`);
await sleep(200);
for (let i = 0; i < 2; i++) {
  await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
  await sleep(500);
}
const peak2 = +(await ev(`window.__maxEye.toFixed(2)`)).value;

console.log(`屋顶高度 3.8 米，眼睛高度上限应为 ${(3.8 - 0.12).toFixed(2)} 米`);
check("站在餐桌上跳跃，眼睛不穿出屋顶", peak <= 3.8 - 0.10, `最高 ${peak}`);
check("站在水槽台上跳跃，眼睛不穿出屋顶", peak2 <= 3.8 - 0.10, `最高 ${peak2}`);

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
