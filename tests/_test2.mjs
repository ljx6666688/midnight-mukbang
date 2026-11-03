// 第二轮：验证移动、碰撞、灼烧、烤熟吃掉
import fs from "node:fs";

const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "C:\\Users\\liuji\\Desktop\\111\\game\\_test2.png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/i.test(t.url));
if (!page) throw new Error("no game page");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) return { error: (r.result.exceptionDetails.exception?.description) || r.result.exceptionDetails.text };
  return { value: r.result?.result?.value };
};
const key = async (type, k, code, vk) => {
  await send("Input.dispatchKeyEvent", {
    type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    text: type === "keyDown" ? k : undefined,
  });
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(4000);

// 开局
await ev(`document.getElementById('startBtn').click()`);
await sleep(800);

/* ---------- 1. 移动 ---------- */
const p0 = await ev(`JSON.stringify({x:+window.__game.player.pos.x.toFixed(2), z:+window.__game.player.pos.z.toFixed(2)})`);
await key("keyDown", "w", "KeyW", 87);
await sleep(700);
await key("keyUp", "w", "KeyW", 87);
await sleep(200);
const p1 = await ev(`JSON.stringify({x:+window.__game.player.pos.x.toFixed(2), z:+window.__game.player.pos.z.toFixed(2)})`);
console.log("移动前:", p0.value, "→ 移动后:", p1.value);

/* ---------- 2. 碰撞：走向餐桌（中央障碍） ---------- */
await ev(`(() => { const g = window.__game; g.player.pos.set(0, 1.62, 2.2); g.player.yaw = 0; })()`);
await key("keyDown", "w", "KeyW", 87);
await sleep(1400);
await key("keyUp", "w", "KeyW", 87);
await sleep(150);
const p2 = await ev(`JSON.stringify({x:+window.__game.player.pos.x.toFixed(2), z:+window.__game.player.pos.z.toFixed(2)})`);
console.log("撞向餐桌后（桌子在 z=0.4，半深 0.6，应停在 z>1 附近）:", p2.value);

/* ---------- 3. 灼烧掉血 ---------- */
await ev(`(() => {
  const g = window.__game;
  g.spawnParcel();
})()`);
await sleep(1800);
const burn = await ev(`(() => {
  const g = window.__game;
  const b = g.boxes[g.boxes.length - 1];
  g.openBox(b);
  g.startBurning(b);
  // 站在火里
  g.player.pos.set(b.group.position.x + 0.3, 1.62, b.group.position.z + 0.3);
  return JSON.stringify({ hp0: Math.round(g.state.hp), fires: g.fires.length });
})()`);
await sleep(1600);
const burn2 = await ev(`JSON.stringify({ hp: Math.round(window.__game.state.hp), fires: window.__game.fires.length })`);
console.log("站火里:", burn.value, "→ 1.6 秒后:", burn2.value);

/* ---------- 4. 烤熟并吃掉 ---------- */
const eat = await ev(`(() => {
  const g = window.__game;
  // 走到火边但保留一点距离，模拟"靠近火烤"
  const fire = g.fires[0];
  const fp = fire.burn.flame.position;
  g.player.pos.set(fp.x + 1.2, 1.62, fp.z + 1.2);
  const food = g.foods[0];
  if (!food) return JSON.stringify({ err: 'no food' });
  g.state.held = food;
  g.state.heldCook = 0;
  food.mesh.visible = false;
  return JSON.stringify({ held: food.type.name, fans0: Math.floor(g.state.fans) });
})()`);
await sleep(2600); // 站着烤
const cooked = await ev(`JSON.stringify({ cook: +window.__game.state.heldCook.toFixed(2) })`);
const eatRes = await ev(`(() => {
  const g = window.__game;
  const before = Math.floor(g.state.fans);
  g.eatHeld();
  return JSON.stringify({ fansBefore: before, fansAfter: Math.floor(g.state.fans), eaten: g.state.eaten });
})()`);
console.log("手持:", eat.value, "→ 烤了 2.6 秒:", cooked.value);
console.log("吃掉:", eatRes.value);

/* ---------- 5. 能力解锁 ---------- */
const abil = await ev(`(() => {
  const g = window.__game;
  g.state.fans = 700;
  return 'set fans 700';
})()`);
await sleep(400);
const abil2 = await ev(`JSON.stringify({
  abilities: Object.keys(window.__game.state.abilities).filter(k => window.__game.state.abilities[k]),
  waterCapNote: document.getElementById('water').textContent
})`);
console.log("粉丝 700 后:", abil.value, abil2.value);

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
if (shot.result?.data) fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log("截图:", SHOT);

console.log("\n=== errors ===");
console.log(errors.length ? errors.slice(0, 10).join("\n") : "(no errors)");
ws.close();
process.exit(errors.length ? 1 : 0);
