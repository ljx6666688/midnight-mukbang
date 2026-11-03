// 弹幕「像真的」+ 消防车不会一来就上门 的验证
//  1) 没着火时，观众不会一直念叨着火
//  2) 弹幕分类只在符合当前局面时才会被选中
//  3) 点一把小火 → 不会有消防车
//  4) 火真的大了（多团火 + 烧够久 + 热度够） → 消防车才来
//  5) 扑灭后弹幕立刻切回"终于灭了 / 闲聊"，不再复读着火
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
    try {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result?.result?.value === true) return true;
    } catch (e) { }
    await sleep(interval);
  }
  return false;
}
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

await send("Runtime.enable"); await send("Page.enable");
await ev(`window.__game && window.__game.clearInputModeOverride()`);
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("!!window.__game")) break; }

// 干净地重开一局，并清空弹幕区
await ev(`(() => { const g = window.__game; document.getElementById("startBtn").click(); return 1; })()`);
await sleep(1200);
check("游戏已开始", await ev(`window.__game.state.running`) === true);
await ev(`document.getElementById("danmaku").innerHTML = ""`);

/* ---------- 1. 弹幕池本身：闲聊里不该出现"着火"这种话 ---------- */
const idleLeak = JSON.parse(await ev(`(() => {
  const pools = window.__game.DANMAKU_POOLS;
  const bad = [];
  const fireWords = ["火", "烧", "灭", "消防", "报警", "糊", "焦", "烟", "灰"];
  for (const line of (pools.idle || [])) {
    for (const w of fireWords) if (line.indexOf(w) >= 0) bad.push(line + " ← " + w);
  }
  for (const line of (pools.box || [])) {
    for (const w of ["火", "烧", "灭"]) if (line.indexOf(w) >= 0) bad.push("box: " + line);
  }
  return JSON.stringify(bad);
})()`));
check("闲聊弹幕不聊火（没起火时不出戏）", idleLeak.length === 0, idleLeak.slice(0, 3).join(" | "));

const poolSizes = JSON.parse(await ev(`(() => {
  const p = window.__game.DANMAKU_POOLS;
  const o = {}; for (const k in p) o[k] = p[k].length; return JSON.stringify(o);
})()`));
check("弹幕按场景分了组（≥8 组）", Object.keys(poolSizes).length >= 8 && Object.values(poolSizes).every(n => n >= 4), JSON.stringify(poolSizes));

/* ---------- 2. 没火时：抽 200 次，不该出现火相关分类 ---------- */
check("开局没有火", await ev(`window.__game.fires.length`) === 0);
const catsNoFire = JSON.parse(await ev(`(() => {
  const g = window.__game, hit = {};
  for (let i = 0; i < 200; i++) { const c = g.pickDanmakuCat(); hit[c] = (hit[c] || 0) + 1; }
  return JSON.stringify(hit);
})()`));
const fireCats = ["fire", "bigFire"].filter(c => catsNoFire[c]);
check("没着火时不会抽到「起火」类弹幕", fireCats.length === 0, JSON.stringify(catsNoFire));
check("没着火时主要是闲聊", (catsNoFire.idle || 0) > 120, JSON.stringify(catsNoFire));

/* ---------- 3. 真跑一段：开局挂机，看实际播出来的弹幕 ---------- */
await ev(`document.getElementById("danmaku").innerHTML = ""`);
await sleep(14000);
const playedIdle = await ev(`Array.from(document.getElementById("danmaku").children).map(e => e.textContent)`);
const idleFireLeak = (playedIdle || []).filter(t => ["火", "烧", "消防", "报警", "糊", "焦"].some(w => t.indexOf(w) >= 0) && t.indexOf("【系统】") !== 0);
check("挂机十几秒，弹幕始终没提着火", idleFireLeak.length === 0,
  (playedIdle || []).length + " 条：" + (idleFireLeak.slice(0, 2).join(" | ") || "无"));
check("挂机时确实在播弹幕", (playedIdle || []).length >= 2, (playedIdle || []).length + " 条");

/* ---------- 4. 点一把小火：不该有消防车 ---------- */
const lit = await ev(`(() => {
  const g = window.__game;
  g.state.cumulativeHeat = 0;
  g.state.fireActiveTime = 0;
  g.spawnParcel();
  const b = g.boxes[g.boxes.length - 1];
  g.startBurning(b);
  return g.fires.length;
})()`);
check("点着了一团火", lit >= 1, "fires=" + lit);
await sleep(2000);
const catsFire = JSON.parse(await ev(`(() => {
  const g = window.__game, hit = {};
  for (let i = 0; i < 200; i++) { const c = g.pickDanmakuCat(); hit[c] = (hit[c] || 0) + 1; }
  return JSON.stringify(hit);
})()`));
check("有火时观众开始聊火", ((catsFire.fire || 0) + (catsFire.bigFire || 0)) > 60, JSON.stringify(catsFire));

// 单团火 + 举报热度：热度就算顶到报警线也不该有消防车（现场没失控）
await ev(`(() => {
  const g = window.__game;
  g.state.cumulativeHeat = g.TUNE.firefighterHeat + 30;
  return g.state.cumulativeHeat;
})()`);
await sleep(1500);
const noTruckSingle = await ev(`window.__game.truckPhase()`) === "idle";
check("只有一团火时，热度再高也不招消防车", noTruckSingle, "truckPhase=" + await ev(`window.__game.truckPhase()`));

// 火刚起、还没烧够时间：也不该有消防车
await ev(`(() => { const g = window.__game; g.state.fireActiveTime = 0; g.state.cumulativeHeat = g.TUNE.firefighterHeat + 60; return 1; })()`);
await sleep(800);
check("火没烧够时间也不招消防车", await ev(`window.__game.truckPhase()`) === "idle");

/* ---------- 5. 真失控了：多团火 + 烧够久 → 消防车才来 ---------- */
await ev(`(() => {
  const g = window.__game;
  for (let i = 0; i < 3; i++) {
    g.spawnParcel();
    const b = g.boxes[g.boxes.length - 1];
    if (b) g.startBurning(b);
  }
  g.state.fireActiveTime = g.TUNE.firefighterMinFire + 1;
  g.state.cumulativeHeat = g.TUNE.firefighterHeat + 30;
  return g.fires.length;
})()`);
const truckCame = await waitFor(`window.__game.truckPhase() !== "idle"`, 12000);
check("多团火失控后消防车才上门", truckCame, "fires=" + await ev(`window.__game.fires.length`) + " phase=" + await ev(`window.__game.truckPhase()`));
check("消防车事件有横幅提示", await ev(`document.getElementById("interruptBanner").classList.contains("show")`) === true);

// 等中断结束
await waitFor(`window.__game.state.interrupted <= 0`, 20000);
await sleep(1500);

/* ---------- 6. 扑灭之后：弹幕立刻切回"灭了/闲聊" ---------- */
await ev(`(() => {
  const g = window.__game;
  for (const f of g.fires.slice()) {
    if (f.kind === "box") g.burnBoxToAsh(g.boxes.find(b => b === f) || g.boxes[0]);
  }
  return 1;
})()`);
await ev(`(() => {
  // 剩下的家具火/地面火直接靠泼水关掉：给满水连泼几发
  const g = window.__game;
  g.state.water = 2;
  return 1;
})()`);
for (let i = 0; i < 12 && await ev(`window.__game.fires.length`) > 0; i++) {
  await ev(`(() => { const g = window.__game; g.state.water = 2; g.state.interrupted = 0; g.splashWater(); return 1; })()`);
  await sleep(400);
}
const firesLeft = await ev(`window.__game.fires.length`);
check("火都灭了（测试环境）", firesLeft === 0, "fires=" + firesLeft);
await ev(`document.getElementById("danmaku").innerHTML = ""`);
await sleep(4000);
const catsOut = JSON.parse(await ev(`(() => {
  const g = window.__game, hit = {};
  for (let i = 0; i < 200; i++) { const c = g.pickDanmakuCat(); hit[c] = (hit[c] || 0) + 1; }
  return JSON.stringify(hit);
})()`));
check("灭完之后不再抽到「起火」类弹幕", !catsOut.fire && !catsOut.bigFire, JSON.stringify(catsOut));
check("灭完之后会说「终于灭了」一类的话", (catsOut.out || 0) > 0 || (catsOut.idle || 0) > 100, JSON.stringify(catsOut));

const playedOut = await ev(`Array.from(document.getElementById("danmaku").children).map(e => e.textContent)`);
const outLeak = (playedOut || []).filter(t => ["火", "烧", "消防"].some(w => t.indexOf(w) >= 0) && t.indexOf("【系统】") !== 0);
check("灭火后播出的弹幕不再念叨着火", outLeak.length === 0, (playedOut || []).slice(0, 3).join(" | "));

check("无 JS 异常", errors.length === 0, errors.slice(0, 2).join(" | "));

const shot = await send("Page.captureScreenshot", { format: "png" });
const fs = await import("node:fs");
if (shot.result?.data) fs.writeFileSync("C:/Users/liuji/Desktop/111/game/_danmaku.png", Buffer.from(shot.result.data, "base64"));

console.log(fail === 0 ? "\n全部通过 ✅" : `\n${fail} 项失败 ❌`);
process.exit(fail === 0 ? 0 : 1);
