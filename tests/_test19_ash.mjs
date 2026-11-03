const PORT = process.argv[2] || "9333";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
async function waitFor(expr, timeoutMs = 20000, interval = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.result?.result?.value === true) return true;
    await sleep(interval);
  }
  return false;
}
await send("Runtime.enable"); await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60; i++) { await sleep(300); const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true }); if (r.result?.result?.value === true) break; }
await ev(`document.getElementById('startBtn').click()`);
await sleep(800);
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

const before = JSON.parse((await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  g.TUNE.firefighterHeat = 1e9; g.TUNE.complaintHeat = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnParcel();
  const b = g.boxes[0];
  b.pbody.position.set(0, b.size.y / 2, -2.0); b.pbody.wakeUp();
  g.player.pos.set(0, g.TUNE.eyeHeight, -0.8); g.player.feet = 0; g.player.yaw = 0;
  window.__B = b;
  g.startBurning(b);
  b.burn.carbon = 0.9;   // 快烧完了
  return JSON.stringify({ boxes: g.boxes.length, ash: g.ashCount(), colliderCount: g.colliders.length });
})()`)).value);
check("初始有 1 个燃烧中的箱子", before.boxes === 1, JSON.stringify(before));

const gone = await waitFor(`!window.__game.boxes.includes(window.__B)`, 25000);
await sleep(400);
const after = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const stillHasCollider = g.colliders.some(c => c.box === window.__B);
  const inFireList = g.fires.some(f => f === window.__B);
  return JSON.stringify({
    stillInBoxes: g.boxes.includes(window.__B),
    ash: g.ashCount(),
    fires: g.fires.length,
    stillHasCollider,
    inFireList,
    walkThrough: !g.playerCollide(0, -2.0, 0)
  });
})()`)).value);
check("烧完后这个箱子消失", gone === true && after.stillInBoxes === false, JSON.stringify(after));
check("原地留下灰烬", after.ash > 0, `灰烬 ${after.ash} 处`);
check("箱子从火源列表移除（不再燃烧）", after.inFireList === false, JSON.stringify(after));
check("碰撞体一起移除（能走过去了）", after.stillHasCollider === false && after.walkThrough === true,
  `还有碰撞体=${after.stillHasCollider}`);

// 可以继续收新快递
await ev(`window.__game.TUNE.parcelInterval = 1e9; window.__game.spawnParcel()`);
await sleep(600);
const reclaimed = JSON.parse((await ev(`JSON.stringify({ boxes: window.__game.boxes.length })`)).value);
check("新快递能正常到达", reclaimed.boxes >= 1, JSON.stringify(reclaimed));

console.log(errors.length ? "报错: " + errors.join("\n") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
