// 验证：箱子贴地、食材物理掉落、烤制时间、三段颜色、食材种类
import fs from "node:fs";
const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "C:\\Users\\liuji\\Desktop\\111\\game\\_food.png";
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
  if (r.result?.exceptionDetails) {
    const msg = r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text;
    console.error("PAGE ERROR:", msg);
    throw new Error(msg);
  }
  return { value: r.result?.result?.value };
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
// 等待页面就绪（__game 存在）再继续
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true });
  if (r.result?.result?.value === true) { ready = true; break; }
}
if (!ready) { console.error("页面未就绪"); process.exit(1); }
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

// ---------- 1. 箱子贴地 ----------
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  g.TUNE.firefighterHeat = 1e9; g.TUNE.complaintHeat = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnParcel();
  const b = g.boxes[0];
  b.pbody.position.set(0, 1.2, 1.2);
  b.pbody.velocity.set(0, 0, 0);
  b.pbody.quaternion.setFromEuler(0, 0, 0);
  b.pbody.wakeUp();
  window.__B = b;
})()`);
await sleep(1800);
const ground = JSON.parse((await ev(`(() => {
  const g = window.__game, b = window.__B;
  // 用渲染出的模型算视觉最低点（世界坐标）
  const box3 = new THREE.Box3().setFromObject(b.body);
  return JSON.stringify({
    visualBottom: +box3.min.y.toFixed(3),
    bodyBottom: +(b.pbody.position.y - b.size.y / 2).toFixed(3),
    groupY: +b.group.position.y.toFixed(3),
    halfH: +(b.size.y / 2).toFixed(3)
  });
})()`)).value);
check("箱子视觉底部贴地（误差 < 2cm）", Math.abs(ground.visualBottom) < 0.02,
  `模型最低点 y=${ground.visualBottom}，物理底部 ${ground.bodyBottom}`);

// ---------- 2. 食材从箱子里掉出来并落到地面/桌面 ----------
const foodSpawn = JSON.parse((await ev(`(() => {
  const g = window.__game, b = window.__B;
  g.openBox(b);
  const f = g.foods[g.foods.length - 1];
  window.__F = f;
  window.__F0 = [f.pbody.position.x, f.pbody.position.z];
  return JSON.stringify({
    type: f.type.name,
    hasBody: !!f.pbody,
    spawnY: +f.mesh.position.y.toFixed(2)
  });
})()`)).value);
await sleep(2200);
const foodLand = JSON.parse((await ev(`(() => {
  const f = window.__F;
  return JSON.stringify({
    y: +f.mesh.position.y.toFixed(3),
    bodyY: f.pbody ? +f.pbody.position.y.toFixed(3) : null,
    moved: f.pbody ? +Math.hypot(f.pbody.position.x - window.__F0[0], f.pbody.position.z - window.__F0[1]).toFixed(3) : 0,
    meshFollows: Math.abs(f.mesh.position.y - (f.pbody ? f.pbody.position.y : 0)) < 0.01
  });
})()`)).value);
check("开箱后食材有物理体", foodSpawn.hasBody === true, JSON.stringify(foodSpawn));
check("食材会从箱子里动起来并落到支撑面上", foodLand.moved > 0.05 && foodLand.y < 1.2,
  `生成于 y=${foodSpawn.spawnY} → 落到 y=${foodLand.y}，水平位移 ${foodLand.moved}`);
check("渲染模型跟随食材物理体", foodLand.meshFollows === true);

// ---------- 3. 烤制时间与三段颜色 ----------
const cookInfo = JSON.parse((await ev(`(() => {
  const g = window.__game, f = window.__F;
  // 放到火边烤：先点着一个箱子
  const b2 = g.boxes[0];
  g.startBurning(b2);
  g.player.pos.set(b2.group.position.x, g.TUNE.eyeHeight, b2.group.position.z + 0.9);
  g.player.feet = 0;
  g.state.held = f;
  if (f.pbody) { g.world.removeBody(f.pbody); f.pbody = null; }
  f.mesh.visible = false;
  g.state.heldCook = 0;
  window.__colRaw = [+f.mat.color.r.toFixed(2), +f.mat.color.g.toFixed(2), +f.mat.color.b.toFixed(2)];
  return JSON.stringify({ cookRate: g.TUNE.cookRate, raw: window.__colRaw });
})()`)).value);
await sleep(2600);
const midCook = JSON.parse((await ev(`(() => {
  const g = window.__game, f = window.__F;
  return JSON.stringify({
    cook: +g.state.heldCook.toFixed(2),
    color: [+f.mat.color.r.toFixed(2), +f.mat.color.g.toFixed(2), +f.mat.color.b.toFixed(2)]
  });
})()`)).value);
check("烤制时间被延长（2.6 秒还在生/半熟）", midCook.cook > 0 && midCook.cook < 0.4, `2.6 秒熟度 ${midCook.cook}`);
// 颜色变化：食材只在"火边"才会被重新上色，而火会烧完、会被消防车浇灭导致逻辑暂停，
// 所以这里一边维持一团活火 + 站到火上，一边用定时器把熟度钉住，取样稳定可靠。
const placeBox = () => ev(`(() => {
  const g = window.__game;
  g.state.interrupted = 0;
  if (g.boxes.length >= g.TUNE.maxParcels) { try { g.burnBoxToAsh(g.boxes[0]); } catch (e) {} }
  g.spawnParcel();
  const b = g.boxes[g.boxes.length - 1];
  window.__TB = b;
  if (b) {
    b.pbody.position.set(g.player.pos.x + 0.15, 0.6, g.player.pos.z - 0.85);
    b.pbody.velocity.set(0, 0, 0);
    b.pbody.angularVelocity.set(0, 0, 0);
    b.pbody.wakeUp();
  }
  return g.boxes.length;
})()`);
// 点着上一个箱子，并把玩家挪到火堆正上方（烤制范围按 3D 距离算）
const lightAndStand = () => ev(`(() => {
  const g = window.__game, b = window.__TB;
  if (b) g.startBurning(b);
  const f = g.fires[g.fires.length - 1];
  if (f && f.burn && f.burn.rig) {
    const c = f.burn.rig.group.position;
    g.player.pos.set(c.x, g.TUNE.eyeHeight, c.z);
    g.player.feet = 0;
  }
  return g.fires.length;
})()`);
// 钉住熟度：每 60ms 复位一次，任何时刻取样都是稳定值
const pinCook = (cook) => ev(`(() => {
  const g = window.__game;
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    try {
      g.state.interrupted = 0;
      g.state.heldCook = ${cook};
      if (g.state.held) g.state.held.cook = ${cook};
    } catch (e) {}
  }, 60);
  return ${cook};
})()`);
const unpinCook = () => ev(`(() => { if (window.__pin) clearInterval(window.__pin); window.__pin = null; return 1; })()`);
const heldColor = () => ev(`(() => {
  const c = window.__game.state.held.mat.color;
  return JSON.stringify([+c.r.toFixed(2), +c.g.toFixed(2), +c.b.toFixed(2)]);
})()`).then(r => JSON.parse(r.value));
const sampleAt = async (cook) => {
  await placeBox();
  await sleep(280);            // 等一帧让箱子的可视位置同步（火焰挂架按可视位置建）
  await lightAndStand();
  await pinCook(cook);
  await sleep(500);
  const col = await heldColor();
  await unpinCook();
  return col;
};

const colRaw = await sampleAt(0);
const colMid2 = await sampleAt(0.5);
const dRaw = Math.abs(colMid2[0] - colRaw[0]) + Math.abs(colMid2[1] - colRaw[1]);
check("颜色随熟度明显变化（生 → 半熟）", dRaw > 0.12, `生 ${colRaw} → 半熟 ${colMid2}`);
// 烤制速度：直接核对参数（headless 帧率低会让 dt 被钳制，墙钟计时不可靠）
const rate = JSON.parse((await ev(`JSON.stringify({ cookRate: window.__game.TUNE.cookRate })`)).value);
check("烤制速度够慢（生→熟 ≥ 6 秒）", rate.cookRate <= 0.09, `cookRate=${rate.cookRate}/秒`);

// 生→熟→糊 的亮度落差
const contrast = JSON.parse((await ev(`(() => {
  const t = window.__game.FOOD_TYPES[0];
  const lum = (hex) => {
    const r = (hex >> 16 & 255) / 255, g2 = (hex >> 8 & 255) / 255, b = (hex & 255) / 255;
    return 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
  };
  return JSON.stringify({ raw: +lum(t.raw).toFixed(2), cooked: +lum(t.cooked).toFixed(2), burnt: +lum(t.burnt).toFixed(2) });
})()`)).value);
check("生→熟→糊亮度落差明显",
  contrast.raw - contrast.cooked > 0.25 && contrast.cooked - contrast.burnt > 0.05,
  `生 ${contrast.raw} → 熟 ${contrast.cooked} → 糊 ${contrast.burnt}`);

// 推到全焦：颜色应接近炭黑，且发光熄灭
await sampleAt(1.0);                     // 先把熟度推到 1.0（同时保证火还在）
await pinCook(1.0);
const burntOk = await waitFor(`window.__game.state.held.mat.color.r < 0.2`, 6000);
const burntNow = JSON.parse((await ev(`(() => {
  const f = window.__game.state.held;
  return JSON.stringify({
    cook: +f.cook.toFixed(2),
    color: [+f.mat.color.r.toFixed(2), +f.mat.color.g.toFixed(2), +f.mat.color.b.toFixed(2)],
    emissive: +f.mat.emissive.r.toFixed(2)
  });
})()`)).value);
await unpinCook();
check("全焦时接近炭黑且不再发光",
  burntOk && burntNow.color[0] < 0.4 && burntNow.emissive < 0.02,
  `颜色 ${burntNow.color}，自发光 ${burntNow.emissive}`);
// ---------- 4. 食材种类 ----------
const kinds = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify(g.FOOD_TYPES ? g.FOOD_TYPES.map(t => t.name) : []);
})()`)).value);
check("食材种类包含要求的五种以上", Array.isArray(kinds) && kinds.length >= 5, JSON.stringify(kinds));

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
