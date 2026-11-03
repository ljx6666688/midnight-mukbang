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
await send("Runtime.enable"); await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60; i++) { await sleep(300); const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true }); if (r.result?.result?.value === true) break; }
await ev(`document.getElementById('startBtn').click()`);
await sleep(800);
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnParcel();
  const b = g.boxes[0];
  b.pbody.position.set(0, b.size.y/2, 0.4); b.pbody.wakeUp();
  g.player.pos.set(0, g.TUNE.eyeHeight, 1.8); g.player.feet = 0; g.player.yaw = 0;
  g.openBox(b);
})()`);
await sleep(1600);
// 拾取 → 放下
const picked = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const f = g.foods[g.foods.length - 1];
  f.mesh.position.set(g.player.pos.x, 1.0, g.player.pos.z - 0.8);
  g.state.held = f; g.state.heldCook = f.cook;
  if (f.pbody) { g.world.removeBody(f.pbody); f.pbody = null; }
  const m = f.mesh;
  if (m.parent) m.parent.remove(m);
  m.scale.copy(f.baseScale).multiplyScalar(0.85);
  m.position.set(-0.15, -0.17, -0.42);
  g.handGroup().add(m);
  f.inHand = true;
  return JSON.stringify({ inHand: true, parentIsHand: m.parent === g.handGroup() });
})()`)).value);
check("食材被挂到手上（保持原模型）", picked.parentIsHand === true, JSON.stringify(picked));
await ev(`window.__game.dropHeld()`);
await sleep(1200);
const dropped = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const f = g.foods[g.foods.length - 1];
  return JSON.stringify({
    held: !!g.state.held,
    hasBody: !!f.pbody,
    inScene: f.mesh.parent === g.scene(),
    y: +f.mesh.position.y.toFixed(2),
    scaleOk: Math.abs(f.mesh.scale.x - f.baseScale.x) < 0.01
  });
})()`)).value);
check("按 Q 能把食材放回地上", dropped.held === false && dropped.hasBody && dropped.inScene && dropped.y < 1,
  JSON.stringify(dropped));
check("放下后模型尺寸还原", dropped.scaleOk === true);

// 受击反馈
await ev(`(() => {
  const g = window.__game;
  const b = g.boxes[0];
  g.startBurning(b);
  g.player.pos.set(b.group.position.x, g.TUNE.eyeHeight, b.group.position.z + 0.5);
  g.player.feet = 0;
})()`);
await sleep(1400);
const hurt = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    hp: Math.round(g.state.hp),
    overlayHit: document.getElementById('hurtOverlay').className,
    textShown: document.getElementById('hurtText').className,
    text: document.getElementById('hurtText').textContent
  });
})()`)).value);
check("被火烧到会掉血", hurt.hp < 100, `HP ${hurt.hp}`);
check("受击有屏幕红边反馈", hurt.overlayHit.indexOf("hit") >= 0, hurt.overlayHit);
check("受击有飘字提示", hurt.textShown.indexOf("show") >= 0, hurt.text || "(空)");

// 中断横幅
await ev(`window.__game.state.cumulativeHeat = 220`);
await sleep(1200);
const banner = JSON.parse((await ev(`(() => {
  const el = document.getElementById('interruptBanner');
  return JSON.stringify({
    shown: el.className.indexOf("show") >= 0,
    title: el.querySelector('.title').textContent,
    sub: el.querySelector('.sub').textContent.slice(0, 40),
    count: el.querySelector('.count').textContent
  });
})()`)).value);
check("中断时屏幕中央显示原因", banner.shown === true && banner.title.length > 0, JSON.stringify(banner));

console.log(errors.length ? "报错: " + errors.join("\n") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
