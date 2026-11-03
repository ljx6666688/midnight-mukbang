const PORT = process.argv[2] || "9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function waitFor(expr, timeoutMs = 25000, interval = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result?.result?.value === true) return true;
    } catch (e) {}
    await sleep(interval);
  }
  return false;
}
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 点火 → 触发消防车
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnParcel();
  const b = g.boxes[0];
  b.pbody.position.set(0, b.size.y / 2, 0.4);
  b.pbody.wakeUp();
  g.player.pos.set(0, g.TUNE.eyeHeight, 2.4);
  g.player.feet = 0; g.player.yaw = 0;
  g.startBurning(b);
  window.__B = b;
  g.forceFirefighter();            // 直接触发消防车事件（新逻辑下热度不再是唯一条件）
})()`);
await waitFor(`window.__game.floodLevel() > 0.05`, 25000);
await sleep(500);
const s1 = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    interrupted: +g.state.interrupted.toFixed(1),
    fires: g.fires.length,
    floodLevel: +g.floodLevel().toFixed(2),
    truckX: +g.truckX().toFixed(1)
  });
})()`)).value);
console.log("  事件中:", JSON.stringify(s1));
check("触发消防车后直播被中断", s1.interrupted > 0, `剩余 ${s1.interrupted} 秒`);
check("消防车开到了屋外", s1.truckX > 5 + 2, `车位置 x=${s1.truckX}`);
check("屋里开始灌水", s1.floodLevel > 0.02, `水位 ${s1.floodLevel}`);

await waitFor(`window.__game.fires.length === 0`, 25000);
await sleep(500);
const s2 = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ fires: g.fires.length, floodLevel: +g.floodLevel().toFixed(2) });
})()`)).value);
console.log("  喷水后:", JSON.stringify(s2));
check("水柱把火浇灭了", s2.fires === 0, `剩余火 ${s2.fires} 处`);
check("水位涨起来了", s2.floodLevel > 0.2, `水位 ${s2.floodLevel}`);

await waitFor(`window.__game.state.interrupted <= 0 && window.__game.floodLevel() < 0.3`, 40000);
await sleep(500);
const s3 = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ fires: g.fires.length, floodLevel: +g.floodLevel().toFixed(2), interrupted: +g.state.interrupted.toFixed(1) });
})()`)).value);
console.log("  收尾:", JSON.stringify(s3));
check("火灭后水会慢慢褪去", s3.floodLevel < 0.3, `水位 ${s3.floodLevel}`);
check("中断结束后恢复可玩", s3.interrupted <= 0, `interrupted=${s3.interrupted}`);
console.log(errors.length ? "报错: " + errors.join("\n") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
