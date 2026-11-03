// 本地解说引擎的验证：它是不是真的"看着局面说话"
//  1) 局面 → 话题：血少就说血、满地灰就说灰、家具烧了就说家具、吃生肉就说生肉
//  2) 数字是真的：台词里的数值跟状态一致
//  3) 不瞎说：没火的时候不会说出"火""烧"
//  4) 不唠叨：同一件事在冷却期内不会重复播
//  5) 实跑：真的玩一会儿，看播出来的话对不对味
const PORT = process.argv[2] || "9333";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && /index\.html/.test(t.url)) || list.find(t => t.type === "page" && /^file:/.test(t.url)) || list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
async function waitFor(expr, timeoutMs = 20000, interval = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.result?.result?.value === true) return true; } catch (e) { }
    await sleep(interval);
  }
  return false;
}
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 反复抽解说词（每次都清掉冷却，模拟"这一局面下它会说什么"）
const sampleNarration = async (times = 40) => JSON.parse(await ev(`(() => {
  const g = window.__game, out = [];
  for (let i = 0; i < ${times}; i++) { g.state.saidAt = {}; const s = g.pickNarration(); if (s) out.push(s); }
  return JSON.stringify(out);
})()`));

await send("Runtime.enable"); await send("Page.enable");
await ev(`window.__game && window.__game.clearInputModeOverride()`);
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("!!window.__game")) break; }
await ev(`document.getElementById("startBtn").click()`);
await sleep(1200);
check("游戏已开始", await ev(`window.__game.state.running`) === true);

/* ---------- 1. 血少 → 说血，且数值对得上 ---------- */
await ev(`(() => { const g = window.__game; g.state.hp = 22; g.state.fireOutAt = -99; g.state.saidAt = {}; return 1; })()`);
let lines = await sampleNarration(60);
let hpLines = lines.filter(t => /血|撤|不敢看/.test(t));
check("血量低时观众会提血量", hpLines.length > 0, hpLines.slice(0, 2).join(" | "));
check("台词里的血量跟真实血量一致", hpLines.some(t => t.indexOf("22") >= 0), hpLines.slice(0, 2).join(" | "));
await ev(`window.__game.state.hp = 100`);

/* ---------- 2. 满地灰 → 说灰 ---------- */
await ev(`(() => {
  const g = window.__game;
  for (let i = 0; i < 5; i++) g.spawnAshPile(1.2 + i * 0.3, 0.5 + i * 0.2);
  g.state.saidAt = {};
  return g.ashCount();
})()`);
const ashNow = await ev(`window.__game.ashCount()`);
lines = await sampleNarration(60);
const ashLines = lines.filter(t => /灰/.test(t));
check("地上灰多时观众会催着扫", ashLines.length > 0, "灰=" + ashNow + " → " + ashLines.slice(0, 2).join(" | "));
check("台词里的灰堆数量和现场一致", ashLines.some(t => t.indexOf(String(ashNow)) >= 0), ashLines.slice(0, 2).join(" | "));

/* ---------- 3. 家具着火 → 点名是哪件家具 ---------- */
const furnInfo = JSON.parse(await ev(`(() => {
  const g = window.__game;
  const furn = g.burnables.find(b => b.kind === "furniture" && !b.isSink && !b.burn);
  if (!furn) return JSON.stringify({ ok: false });
  g.startBurning(furn);
  g.state.saidAt = {};
  return JSON.stringify({ ok: true, label: furn.label });
})()`));
check("找到一件家具并点着", furnInfo.ok === true, furnInfo.label || "");
if (furnInfo.ok) {
  lines = await sampleNarration(60);
  const furnLines = lines.filter(t => furnInfo.label && t.indexOf(furnInfo.label) >= 0);
  check("家具着火时观众会指名道姓", furnLines.length > 0, furnLines.slice(0, 2).join(" | "));
  check("台词里带上了家具名字", furnLines.length > 0 && furnLines[0].indexOf(furnInfo.label) >= 0, furnLines[0] || "");
}

/* ---------- 4. 吃生肉会被吐槽，且带次数 ---------- */
await ev(`(() => { const g = window.__game; g.state.stats.eatenRaw = 4; g.state.saidAt = {}; return 1; })()`);
lines = await sampleNarration(60);
const rawLines = lines.filter(t => /生/.test(t));
check("连吃生食会被观众吐槽", rawLines.length > 0, rawLines.slice(0, 2).join(" | "));
check("吐槽里带上了「第几次」", rawLines.some(t => /[0-9]/.test(t)), rawLines.slice(0, 2).join(" | "));

/* ---------- 5. 不瞎说：清场之后不该再提火 ---------- */
await ev(`(() => {
  const g = window.__game;
  for (const f of g.fires.slice()) {
    if (f.kind === "floor") g.stopFloorFire(f);
    else if (f.kind === "box" && g.boxes.indexOf(f) >= 0) g.burnBoxToAsh(f);
    else g.stopBurning(f);
  }
  return g.fires.length;
})()`);
await sleep(500);
check("火已清空", await ev(`window.__game.fires.length`) === 0, "fires=" + await ev(`window.__game.fires.length`));
lines = await sampleNarration(80);
const fireLeak = lines.filter(t => /火|烧|灭|消防|报警/.test(t));
check("没有火的时候不会说出「火/烧/灭」", fireLeak.length === 0, fireLeak.slice(0, 3).join(" | ") || "无");

/* ---------- 6. 冷却：同一件事不会被反复说 ---------- */
const cooldown = JSON.parse(await ev(`(() => {
  const g = window.__game;
  g.state.hp = 18;            // 血量低这件事一直成立
  g.state.saidAt = {};
  const out = [];
  for (let i = 0; i < 12; i++) { const s = g.pickNarration(); if (s) out.push(s); }
  return JSON.stringify(out);
})()`));
const hpRepeat = cooldown.filter(t => /血|撤/.test(t)).length;
check("同一件事在冷却期内不会重复播", hpRepeat <= 1, "12 次抽取里提到血量 " + hpRepeat + " 次");
await ev(`window.__game.state.hp = 100`);

/* ---------- 7. 实跑：真玩 25 秒，看播出来的话对不对味 ---------- */
await ev(`document.getElementById("danmaku").innerHTML = ""`);
await ev(`(() => {
  const g = window.__game;
  g.state.hp = 100; g.state.saidAt = {}; g.state.chatHistory = [];
  // 三个箱子点在房间那头，玩家站远一点：免得被自己的火烤死，影响观察
  for (let i = 0; i < 3; i++) {
    g.spawnParcel();
    const b = g.boxes[g.boxes.length - 1];
    if (!b) continue;
    b.pbody.position.set(-1.0 + i * 1.0, 0.6, -2.4);
    b.pbody.wakeUp();
    g.startBurning(b);
  }
  if (g.boxes.length) g.openBox(g.boxes[0]);
  g.player.pos.set(0.4, g.TUNE.eyeHeight, 3.6);
  g.player.feet = 0;
  return 1;
})()`);
// 无头浏览器帧率低，模拟时间走得比真实时间慢，所以等"至少两条观众发言"出现再看
const CHATTED = `(() => {
  const els = Array.from(document.getElementById("danmaku").children).map(e => e.textContent);
  return els.filter(t => t.indexOf("【") !== 0 && !/^(🔥|📦)/.test(t) && t.indexOf("：") > 0);
})()`;
await waitFor(`${CHATTED}.length >= 2`, 90000, 500);
check("实跑期间游戏没有结束", await ev(`window.__game.state.running`) === true, "hp=" + Math.round(await ev(`window.__game.state.hp`)));
const played = await ev(`Array.from(document.getElementById("danmaku").children).map(e => e.textContent)`);
const chatted = await ev(CHATTED);
check("实跑时观众在说话", chatted.length >= 2, chatted.slice(0, 3).join(" | ") || "一条都没有");
check("观众说的话都带昵称", chatted.every(t => t.indexOf("：") > 0), chatted.slice(0, 3).join(" | "));
check("说的不是同一句复读", new Set(chatted).size === chatted.length, chatted.join(" | "));
console.log("  实际播出：" + (played || []).join(" ／ "));
check("无 JS 异常", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(fail === 0 ? "\n全部通过 ✅" : `\n${fail} 项失败 ❌`);
process.exit(fail === 0 ? 0 : 1);
