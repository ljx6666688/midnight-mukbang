// 验证：像素火分层、烧到地板、蔓延、烤制范围随火焰变大
import fs from "node:fs";
const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "C:\\Users\\liuji\\Desktop\\111\\game\\_fire.png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && /index\.html/i.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return { value: r.result?.result?.value };
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true });
  if (r.result?.result?.value === true) break;
}
await ev(`document.getElementById('startBtn').click()`);
await sleep(800);

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 摆一个箱子并点燃
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnParcel();
  const b = g.boxes[0];
  b.pbody.position.set(0, b.size.y / 2, 0.2);
  b.pbody.velocity.set(0, 0, 0);
  b.pbody.quaternion.setFromEuler(0, 0, 0);
  b.pbody.wakeUp();
  window.__B = b;
  g.player.pos.set(0, g.TUNE.eyeHeight, 2.3);
  g.player.feet = 0;
  g.player.yaw = 0;
  g.player.pitch = -0.18;
  g.startBurning(b);
  g.TUNE.floorIgnitePerSec = 3;   // 加速测试
})()`);
await sleep(1200);

// 1. 初期只有顶部火焰
const stage0 = JSON.parse((await ev(`(() => {
  const b = window.__B, f = b.burn;
  return JSON.stringify({
    stage: f.stage,
    top: f.rig.top.visible,
    sides: f.rig.sides.visible,
    big: f.rig.big.visible,
    radius: +f.radius.toFixed(2),
    carbon: +f.carbon.toFixed(2)
  });
})()`)).value);
check("开始只烧箱顶", stage0.top === true && stage0.sides === false && stage0.big === false,
  `stage=${stage0.stage} carbon=${stage0.carbon} radius=${stage0.radius}`);

// 2. 碳化中期：火焰烧到四周
await ev(`(() => { window.__B.burn.carbon = 0.45; })()`);
await sleep(500);
const stage1 = JSON.parse((await ev(`(() => {
  const f = window.__B.burn;
  return JSON.stringify({ stage: f.stage, top: f.rig.top.visible, sides: f.rig.sides.visible, big: f.rig.big.visible, radius: +f.radius.toFixed(2) });
})()`)).value);
check("碳化中期火焰蔓延到四周", stage1.sides === true && stage1.big === false && stage1.radius > stage0.radius,
  `stage=${stage1.stage} radius ${stage0.radius} → ${stage1.radius}`);

// 3. 晚期：整体燃烧 + 开始点燃地板
await ev(`(() => { window.__B.burn.carbon = 0.8; })()`);
await sleep(1600);
const stage2 = JSON.parse((await ev(`(() => {
  const g = window.__game, f = window.__B.burn;
  const floorFires = g.fires.filter(x => x.kind === "floor").length;
  return JSON.stringify({ stage: f.stage, big: f.rig.big.visible, radius: +f.radius.toFixed(2), floorFires });
})()`)).value);
check("整体燃烧后火焰包住箱子", stage2.big === true && stage2.radius > stage1.radius,
  `stage=${stage2.stage} radius ${stage1.radius} → ${stage2.radius}`);
check("火会烧到地板上（生成地面火）", stage2.floorFires > 0, `地面火 ${stage2.floorFires} 处`);

// 4. 烤制范围随火焰半径增长
const cookRange = JSON.parse((await ev(`(() => {
  const g = window.__game, f = window.__B.burn;
  const c = { x: window.__B.group.position.x, z: window.__B.group.position.z };
  // 在火焰边缘外 1.6 米处放一份食材，看是否进入烤制范围
  const food = g.spawnFood(new THREE.Vector3(c.x + 1.6, 1.2, c.z), 0);
  return JSON.stringify({ radius: +f.radius.toFixed(2), foodX: +(c.x + 1.6).toFixed(2) });
})()`)).value);
await sleep(1500);
const cooked = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const f = g.foods[g.foods.length - 1];
  return JSON.stringify({ cook: +f.cook.toFixed(2) });
})()`)).value);
check("火焰可视范围内的食材会被烤", cooked.cook > 0.02, `火焰半径 ${cookRange.radius}，距离 1.6 米处的食材熟度 ${cooked.cook}`);

// 5. 地面火会蔓延到旁边的箱子
const spread = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const ff = g.fires.find(x => x.kind === "floor");
  if (!ff) return JSON.stringify({ err: "no floor fire" });
  // 在火边放一个箱子
  g.spawnParcel();
  const b = g.boxes[g.boxes.length - 1];
  b.pbody.position.set(ff.x + 1.1, b.size.y / 2, ff.z);
  b.pbody.velocity.set(0, 0, 0);
  b.pbody.quaternion.setFromEuler(0, 0, 0);
  b.pbody.wakeUp();
  window.__B2 = b;
  g.TUNE.spreadChancePerSec = 5;
  return JSON.stringify({ placed: true });
})()`)).value);
await sleep(2000);
const spreadRes = JSON.parse((await ev(`(() => {
  const b = window.__B2;
  return JSON.stringify({ burning: !!b.burn, fires: window.__game.fires.length });
})()`)).value);
check("地面火能点燃旁边的箱子", spreadRes.burning === true, `火总数 ${spreadRes.fires}`);

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
