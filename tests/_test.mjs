// 无头浏览器自动化测试：加载游戏、收集 JS 报错、点开始、模拟操作、截图
import fs from "node:fs";

const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "C:\\Users\\liuji\\Desktop\\111\\game\\_test.png";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
console.log("targets:", list.map((t) => `${t.type}:${t.url}`).join("\n         "));
const page =
  list.find((t) => t.type === "page" && /index\.html/i.test(t.url)) ||
  list.find((t) => t.type === "page" && /^file:/i.test(t.url)) ||
  list.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("ws error"));
});

let id = 0;
const pending = new Map();
const errors = [];
const logs = [];

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push("EXCEPTION: " + (d.exception && (d.exception.description || d.exception.value) || d.text));
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    logs.push(m.params.type + ": " + text);
    if (m.params.type === "error") errors.push("CONSOLE ERROR: " + text);
  }
  if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    if (e.level === "error") errors.push("LOG ERROR: " + e.text + " " + (e.url || ""));
  }
};

const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { error: (d.exception && (d.exception.description || d.exception.value)) || d.text };
  }
  return { value: r.result?.result?.value };
};

console.log("reloading…");
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const before = await evalJs(`JSON.stringify({
  hasGame: !!window.__game,
  overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
  running: window.__game ? window.__game.state.running : null,
  canvas: !!document.querySelector('canvas')
})`);
console.log("before start:", JSON.stringify(before));

// 开始游戏
await evalJs(`document.getElementById('startBtn').click()`);
await sleep(1200);
console.log("after start:", JSON.stringify(await evalJs(
  `JSON.stringify({running: window.__game.state.running, tool: window.__game.state.tool, hp: window.__game.state.hp})`
)));

// 开局原始视角截图
{
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  if (s.result?.data) {
    fs.writeFileSync(SHOT.replace(/\.png$/, "_spawn.png"), Buffer.from(s.result.data, "base64"));
    console.log("spawn screenshot saved");
  }
}

// 放三个快递、切箱、点火、吃
console.log("actions:", JSON.stringify(await evalJs(`(() => {
  const g = window.__game;
  g.spawnParcel(); g.spawnParcel(); g.spawnParcel();
  return { boxes: g.boxes.length };
})()`)));

await sleep(2500); // 等箱子落地

console.log("after fall:", JSON.stringify(await evalJs(`(() => {
  const g = window.__game;
  return {
    boxes: g.boxes.map(b => ({ y: +b.group.position.y.toFixed(2), weight: +b.weight.toFixed(2) })),
  };
})()`)));

// 直接开箱 + 点火，验证烤制与热量链路
console.log("open+ignite:", JSON.stringify(await evalJs(`(() => {
  const g = window.__game;
  if (!g.boxes.length) return { err: 'no boxes' };
  g.openBox(g.boxes[0]);
  g.startBurning(g.boxes[0]);
  return { opened: g.boxes[0].opened, fires: g.fires.length, foods: g.foods.length };
})()`)));

await sleep(2600);
console.log("after burn 2.6s:", JSON.stringify(await evalJs(`(() => {
  const g = window.__game;
  const s = g.state;
  return {
    fires: g.fires.length,
    fans: Math.floor(s.fans),
    heat: +s.heat.toFixed(1),
    money: Math.round(s.money),
    cumHeat: +s.cumulativeHeat.toFixed(1),
    carbon: g.boxes[0] && g.boxes[0].burn ? +g.boxes[0].burn.carbon.toFixed(2) : null,
  };
})()`)));

// 泼水灭火（走到火堆前，先装水）
console.log("water:", JSON.stringify(await evalJs(`(() => {
  const g = window.__game;
  const b = g.boxes[0];
  g.state.water = 1;
  g.player.pos.set(b.group.position.x, 1.62, b.group.position.z + 1.6);
  g.player.yaw = 0;
  g.setTool('bucket');
  const before = g.fires.length;
  g.splashWater();
  return { firesBefore: before, firesLeft: g.fires.length, water: g.state.water };
})()`)));

await sleep(800);
console.log("final state:", JSON.stringify(await evalJs(
  `JSON.stringify({fans: Math.floor(window.__game.state.fans), hp: Math.round(window.__game.state.hp), money: Math.round(window.__game.state.money), fires: window.__game.fires.length, boxes: window.__game.boxes.length})`
)));

// 截图
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
if (shot.result?.data) {
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
  console.log("screenshot:", SHOT);
}

console.log("\n=== console logs ===");
console.log(logs.slice(0, 20).join("\n") || "(none)");
console.log("\n=== errors ===");
console.log(errors.length ? errors.slice(0, 20).join("\n") : "(no errors)");

ws.close();
process.exit(errors.length ? 1 : 0);
