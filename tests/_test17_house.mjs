const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("node:fs");
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && /index\.html/i.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return { value: r.result?.result?.value };
};
await send("Runtime.enable"); await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60; i++) { await sleep(300); const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true }); if (r.result?.result?.value === true) break; }
await ev(`document.getElementById('startBtn').click()`);
await sleep(800);
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

const before = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ half: g.roomHalf(), furniture: g.burnables.length });
})()`)).value);
console.log("  扩建前:", JSON.stringify(before));

await ev(`window.__game.expandHouse()`);
await sleep(900);
const after = JSON.parse((await ev(`(() => {
  const g = window.__game;
  // 检查四面墙是否都到了新位置，且尺寸覆盖整个边长
  const info = g.roomInfo();
  return JSON.stringify(info);
})()`)).value);
console.log("  扩建后:", JSON.stringify(after));
check("房间变大", after.half > before.half, `half ${before.half} → ${after.half}`);
check("四面墙都推到新位置", after.wallsAtEdge === 4, `到位墙体 ${after.wallsAtEdge}/4`);
check("墙体长度覆盖新边长（没有四角裂缝）", after.wallsCover === 4, `覆盖完整墙体 ${after.wallsCover}/4`);
check("地面/天花板尺寸跟着变大", after.floorSize >= after.half * 2 - 0.01, `地板 ${after.floorSize.toFixed(1)}m`);
check("添置了新家具", after.furniture > before.furniture, `家具 ${before.furniture} → ${after.furniture}`);

// 站在房间里不应陷入地板
const stand = JSON.parse((await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight, g.roomHalf() - 0.6);
  g.player.feet = 0;
  return JSON.stringify({ support: +g.supportHeightAt(0, g.roomHalf() - 0.6, 0).toFixed(2) });
})()`)).value);
check("新区域脚下是实地面", stand.support === 0, `支撑高度 ${stand.support}`);

if (SHOT) {
  await ev(`(() => {
    const g = window.__game;
    g.player.pos.set(0, g.TUNE.eyeHeight, g.roomHalf() - 1.2);
    g.player.yaw = 0; g.player.pitch = -0.05;
  })()`);
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
  console.log("  截图:", SHOT);
}
console.log(errors.length ? "报错: " + errors.join("\n") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
