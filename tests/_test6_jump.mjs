// 第五轮：跳跃与踩箱子
import fs from "node:fs";
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

// 1. 空格起跳，高度会上升后落回地面
await ev(`(() => { const g = window.__game; g.player.pos.set(0, g.TUNE.eyeHeight, 3.2); g.player.feet = 0; g.player.feet = 0; g.player.yaw = 0; })()`);
await sleep(200);
const y0 = +(await ev(`window.__game.player.pos.y.toFixed(2)`)).value;
await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
await sleep(220);
const yPeak = +(await ev(`window.__game.player.pos.y.toFixed(2)`)).value;
await sleep(900);
const yLand = +(await ev(`window.__game.player.pos.y.toFixed(2)`)).value;
check("按空格能跳起来", yPeak > y0 + 0.25, `地面 ${y0} → 空中 ${yPeak}`);
check("跳完会落回地面", Math.abs(yLand - y0) < 0.08, `落地 ${yLand}（地面 ${y0}）`);

// 2. 空中不能二段跳
await ev(`(() => { const g = window.__game; g.player.vy = 0; g.player.pos.y = g.TUNE.eyeHeight; g.player.onGround = true; })()`);
await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
await sleep(150);
const midAir = +(await ev(`window.__game.player.pos.y.toFixed(2)`)).value;
const vyBefore = +(await ev(`window.__game.player.vy.toFixed(2)`)).value;
await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
await sleep(80);
const vyAfter = +(await ev(`window.__game.player.vy.toFixed(2)`)).value;
check("空中再按空格不会二段跳", vyAfter <= vyBefore + 0.01, `起跳高度 ${midAir}，vy ${vyBefore} → ${vyAfter}`);
await sleep(900);

// 3. 落在箱顶上能站住
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
})()`);
await sleep(1600);
const setup = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const b = g.boxes[g.boxes.length - 1]; if (!b) return JSON.stringify({ boxTop: -1 });\n  b.pbody.position.set(0, b.size.y / 2, 1.2); b.pbody.velocity.set(0,0,0); b.pbody.angularVelocity.set(0,0,0); b.pbody.quaternion.setFromEuler(0,0,0); b.pbody.wakeUp();
  
  
  g.player.pos.set(0, g.TUNE.eyeHeight + 1.2, 1.2); g.player.feet = 1.2;
  g.player.yaw = 0;
  g.player.vy = 0;
  return JSON.stringify({ boxTop: +(b.group.position.y + b.size.y / 2).toFixed(2) });
})()`)).value);
await sleep(1200);
const stand = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const feet = g.player.feet;
  return JSON.stringify({ feet: +feet.toFixed(2), onGround: g.player.onGround });
})()`)).value);
check("落在箱顶上能站住", Math.abs(stand.feet - setup.boxTop) < 0.08 && stand.onGround === true,
  `箱顶 ${setup.boxTop}，脚下 ${stand.feet}`);

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
