// 物理引擎验证：落地、叠放、重心偏出会倒、踢飞（用对象引用，避免新快递干扰）
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
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return { value: r.result?.result?.value };
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(4200);
await ev(`document.getElementById('startBtn').click()`);
await sleep(700);

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 关掉自动送货 + 清空现有箱子，只留自己造的三个
await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  for (const b of [...g.boxes]) {
    g.world.removeBody(b.pbody);
    b.group.parent.remove(b.group);
    const i = g.colliders.indexOf(b.collider);
    if (i >= 0) g.colliders.splice(i, 1);
  }
  g.boxes.length = 0;
  return 'cleared';
})()`);
await sleep(200);

// 造三个箱子：A 落地、B 叠上去、C 用于重心测试
const made = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const mk = (x, z, y) => {
    g.spawnParcel();
    const b = g.boxes[g.boxes.length - 1];
    b.pbody.position.set(x, y, z);
    b.pbody.velocity.set(0, 0, 0);
    b.pbody.angularVelocity.set(0, 0, 0);
    b.pbody.quaternion.setFromEuler(0, 0, 0);
    b.pbody.wakeUp();
    return b;
  };
  window.__A = mk(0, -2.6, 2.2);
  window.__B = mk(-2.4, -2.6, 1.0);
  window.__C = mk(3.4, -3.8, 2.6);   // 先放别处，后面再挪
  return JSON.stringify({ aHalf: +(window.__A.size.y / 2).toFixed(3), boxes: g.boxes.length });
})()`)).value);

await sleep(2000);
// 1. 自由落体
const land = JSON.parse((await ev(`(() => {
  const A = window.__A;
  return JSON.stringify({
    y: +A.pbody.position.y.toFixed(3),
    vy: +A.pbody.velocity.y.toFixed(2),
    groupY: +A.group.position.y.toFixed(3),
    sleep: A.pbody.sleepState === 2
  });
})()`)).value);
check("箱子自由落体后静止在地面上", Math.abs(land.y - made.aHalf) < 0.06 && Math.abs(land.vy) < 0.25,
  `落点 y=${land.y}（应为 ${made.aHalf}），vy=${land.vy}，睡眠=${land.sleep}`);
check("渲染模型跟随物理体", Math.abs(land.groupY - land.y) < 0.01, `group.y=${land.groupY}`);

// 2. 叠放：B 摆在 A 正上方
await ev(`(() => {
  const g = window.__game, A = window.__A, B = window.__B;
  B.size.set(A.size.x, A.size.y, A.size.z);
  B.pbody.shapes[0].halfExtents.set(A.size.x / 2, A.size.y / 2, A.size.z / 2);
  B.pbody.updateBoundingRadius();
  B.pbody.position.set(A.pbody.position.x, A.pbody.position.y + A.size.y + 0.03, A.pbody.position.z);
  B.pbody.quaternion.setFromEuler(0, 0, 0);
  B.pbody.velocity.set(0, 0, 0);
  B.pbody.angularVelocity.set(0, 0, 0);
  B.pbody.wakeUp();
})()`);
await sleep(2000);
const stacked = JSON.parse((await ev(`(() => {
  const A = window.__A, B = window.__B;
  return JSON.stringify({
    aY: +A.pbody.position.y.toFixed(3),
    bY: +B.pbody.position.y.toFixed(3),
    expectB: +(A.pbody.position.y + A.size.y / 2 + B.size.y / 2).toFixed(3),
    tilt: +(Math.abs(B.pbody.quaternion.x) + Math.abs(B.pbody.quaternion.z)).toFixed(3)
  });
})()`)).value);
check("两个箱子能叠起来并保持稳定",
  Math.abs(stacked.bY - stacked.expectB) < 0.1 && stacked.tilt < 0.12,
  `下箱 y=${stacked.aY}，上箱 y=${stacked.bY}（应为 ${stacked.expectB}），倾斜=${stacked.tilt}`);

// 3. 重心偏出：C 放到 A 的正上方但横向偏 85%
await ev(`(() => {
  const A = window.__A, C = window.__C;
  C.pbody.position.set(A.pbody.position.x + A.size.x * 0.85, A.pbody.position.y + A.size.y + 0.03, A.pbody.position.z);
  C.pbody.quaternion.setFromEuler(0, 0, 0);
  C.pbody.velocity.set(0, 0, 0);
  C.pbody.angularVelocity.set(0, 0, 0);
  C.pbody.wakeUp();
})()`);
await sleep(2400);
const overhang = JSON.parse((await ev(`(() => {
  const A = window.__A, C = window.__C;
  return JSON.stringify({
    cY: +C.pbody.position.y.toFixed(3),
    aTop: +(A.pbody.position.y + A.size.y / 2).toFixed(3),
    cHalf: +(C.size.y / 2).toFixed(3)
  });
})()`)).value);
check("重心偏出支撑面后箱子掉到地上", overhang.cY < overhang.aTop - 0.05,
  `C 的 y=${overhang.cY}，A 顶面 ${overhang.aTop}，落地高度应约 ${overhang.cHalf}`);

// 4. 踢飞（对 A 施加冲量，看是否被踢走）
const kickBefore = JSON.parse((await ev(`(() => {
  const g = window.__game, A = window.__A;
  // 清掉其他箱子，保证踢到的是 A
  for (const b of [...g.boxes]) {
    if (b === A) continue;
    g.world.removeBody(b.pbody);
    b.group.parent.remove(b.group);
    const ci = g.colliders.indexOf(b.collider);
    if (ci >= 0) g.colliders.splice(ci, 1);
  }
  g.boxes.length = 0;
  g.boxes.push(A);
  g.state.abilities.leg = true;
  g.state.legCooldown = 0;
  g.player.pos.set(A.pbody.position.x, g.TUNE.eyeHeight, A.pbody.position.z + 1.3);
  g.player.feet = 0;
  g.player.yaw = 0;
  g.kick();
  // 立刻读速度，避免箱子撞到东西后减速影响判定
  const v = Math.hypot(A.pbody.velocity.x, A.pbody.velocity.y, A.pbody.velocity.z);
  return JSON.stringify({ x: +A.pbody.position.x.toFixed(2), z: +A.pbody.position.z.toFixed(2), v0: +v.toFixed(2) });
})()`)).value);
await sleep(200);
const kicking = JSON.parse((await ev(`(() => {
  const A = window.__A;
  return JSON.stringify({
    vx: +A.pbody.velocity.x.toFixed(2),
    vz: +A.pbody.velocity.z.toFixed(2),
    spin: +(Math.abs(A.pbody.angularVelocity.x) + Math.abs(A.pbody.angularVelocity.z)).toFixed(2)
  });
})()`)).value);
await sleep(1500);
const kickAfter = JSON.parse((await ev(`(() => {
  const A = window.__A;
  return JSON.stringify({ x: +A.pbody.position.x.toFixed(2), z: +A.pbody.position.z.toFixed(2) });
})()`)).value);
const moved = Math.hypot(kickAfter.x - kickBefore.x, kickAfter.z - kickBefore.z);
check("踢一脚箱子会飞出去并带翻滚", moved > 0.25 && (kicking.spin > 0.5 || kickBefore.v0 > 2),
  `位移 ${moved.toFixed(2)} 米，踢出速度 ${kickBefore.v0} m/s，角速度 ${kicking.spin}`);

console.log(errors.length ? "\n报错: " + errors.slice(0, 6).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
