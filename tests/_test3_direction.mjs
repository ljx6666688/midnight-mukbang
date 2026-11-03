// 方向验证：在四个朝向上按 W/A/S/D，检查位移方向是否符合第一人称直觉
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
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
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
  type: "keyDown", key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k,
});
const keyUp = (k, code, vk) => send("Input.dispatchKeyEvent", {
  type: "keyUp", key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
});

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(4000);
await ev(`document.getElementById('startBtn').click()`);
await sleep(600);

// 每次测试都回到房间中央空地、清零朝向
async function reset(yaw) {
  await ev(`(() => { const g = window.__game; g.player.pos.set(0, 1.62, 2.6); g.player.yaw = ${yaw}; g.player.pitch = 0; })()`);
  await sleep(120);
}
async function press(k, code, vk, ms) {
  await keyDown(k, code, vk);
  await sleep(ms);
  await keyUp(k, code, vk);
  await sleep(120);
}
async function pos() {
  return JSON.parse((await ev(`JSON.stringify({x:+window.__game.player.pos.x.toFixed(2), z:+window.__game.player.pos.z.toFixed(2)})`)).value);
}

const KEYS = {
  w: ["w", "KeyW", 87],
  s: ["s", "KeyS", 83],
  a: ["a", "KeyA", 65],
  d: ["d", "KeyD", 68],
};

// 朝向 0：视线朝 -Z，那么 W 应该是 z 变小，D 应该是 x 变大
const cases = [
  { yaw: 0, k: "w", expect: "z-", desc: "面向-Z 按W应往-Z走" },
  { yaw: 0, k: "s", expect: "z+", desc: "面向-Z 按S应往+Z走" },
  { yaw: 0, k: "a", expect: "x-", desc: "面向-Z 按A应往-X走" },
  { yaw: 0, k: "d", expect: "x+", desc: "面向-Z 按D应往+X走" },
  { yaw: Math.PI / 2, k: "w", expect: "x-", desc: "面向-X 按W应往-X走" },
  { yaw: Math.PI, k: "w", expect: "z+", desc: "面向+Z 按W应往+Z走" },
  { yaw: -Math.PI / 2, k: "w", expect: "x+", desc: "面向+X 按W应往+X走" },
  { yaw: Math.PI / 2, k: "d", expect: "z-", desc: "面向-X 按D应往-Z走" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  await reset(c.yaw);
  const before = await pos();
  await press(...KEYS[c.k], 420);
  const after = await pos();
  const dx = +(after.x - before.x).toFixed(2);
  const dz = +(after.z - before.z).toFixed(2);
  let ok = false;
  if (c.expect === "z-") ok = dz < -0.15 && Math.abs(dx) < 0.15;
  if (c.expect === "z+") ok = dz > 0.15 && Math.abs(dx) < 0.15;
  if (c.expect === "x-") ok = dx < -0.15 && Math.abs(dz) < 0.15;
  if (c.expect === "x+") ok = dx > 0.15 && Math.abs(dz) < 0.15;
  console.log(`${ok ? "OK  " : "FAIL"} ${c.desc}  (dx=${dx}, dz=${dz})`);
  ok ? pass++ : fail++;
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
console.log(errors.length ? "报错: " + errors.join("; ") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
