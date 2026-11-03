// 第三轮机制验证：搬箱子、火烧到相邻箱子、地上食材也能被烤
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
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return { value: r.result?.result?.value };
};
const keyDown = (k, code, vk) => send("Input.dispatchKeyEvent", {
  type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k,
});
const keyUp = (k, code, vk) => send("Input.dispatchKeyEvent", {
  type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
});

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(500);

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
const check = (name, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};

/* ---------- 1. 搬箱子（G 抬起 → 跟着人走 → G 放下） ---------- */
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, 1.62, 2.6); g.player.yaw = 0;
  g.spawnParcel();
})()`);
await sleep(1600);
await ev(`(() => { const g = window.__game; const b = g.boxes[0]; b.pbody.position.set(0, b.size.y/2, 1.6); b.pbody.velocity.set(0,0,0); b.pbody.angularVelocity.set(0,0,0); b.pbody.quaternion.setFromEuler(0,0,0); b.pbody.wakeUp(); })()`);
await sleep(150);

await keyDown("g", "KeyG", 71); await keyUp("g", "KeyG", 71);
await sleep(200);
const carried = JSON.parse((await ev(`JSON.stringify({
  carried: !!window.__game.state.carried,
  y: window.__game.state.carried ? +window.__game.state.carried.group.position.y.toFixed(2) : null
})`)).value);
check("按 G 搬起箱子", carried.carried === true && carried.y > 0.9, JSON.stringify(carried));

await keyDown("w", "KeyW", 87); await sleep(600); await keyUp("w", "KeyW", 87);
await sleep(200);
const follow = JSON.parse((await ev(`(() => {
  const g = window.__game, b = g.state.carried;
  const d = Math.hypot(b.group.position.x - g.player.pos.x, b.group.position.z - g.player.pos.z);
  return JSON.stringify({ dist: +d.toFixed(2), playerZ: +g.player.pos.z.toFixed(2), boxZ: +b.group.position.z.toFixed(2) });
})()`)).value);
check("搬着走时箱子跟着玩家", follow.dist < 1.3, JSON.stringify(follow));

await keyDown("g", "KeyG", 71); await keyUp("g", "KeyG", 71);
await sleep(250);
const dropped = JSON.parse((await ev(`JSON.stringify({
  carried: !!window.__game.state.carried,
  y: +window.__game.boxes[0].group.position.y.toFixed(2),
  colliderX: +window.__game.boxes[0].collider.x.toFixed(2)
})`)).value);
check("按 G 放下箱子（停在支撑面上）", dropped.carried === false && dropped.y >= 0.15 && dropped.y < 4 && dropped.colliderX < 9000, JSON.stringify(dropped));

/* ---------- 2. 火会烧到相邻的箱子 ---------- */
await ev(`(() => {
  const g = window.__game;
  const a = g.boxes[0];
  g.spawnParcel();
  const b = g.boxes[g.boxes.length - 1];
  a.pbody.position.set(0, a.size.y/2, 0); a.pbody.velocity.set(0,0,0); a.pbody.quaternion.setFromEuler(0,0,0); a.pbody.wakeUp();
  b.pbody.position.set(1.2, b.size.y/2, 0); b.pbody.velocity.set(0,0,0); b.pbody.quaternion.setFromEuler(0,0,0); b.pbody.wakeUp();
  g.startBurning(a);
  a.burn.carbon = 0.4;             // 火焰烧到四周后才会蔓延（新设计）
  g.TUNE.spreadChancePerSec = 5;   // 临时调高，测试才等得起
})()`);
await sleep(1500);
const spread = JSON.parse((await ev(`JSON.stringify({
  fires: window.__game.fires.length,
  burningBoxes: window.__game.boxes.filter(b => !!b.burn).length,
  labels: window.__game.fires.map(f => f.kind)
})`)).value);
check("火从一只箱子蔓延到相邻箱子", spread.burningBoxes >= 2, JSON.stringify(spread));

/* ---------- 3. 地上的食材也会被火烤 ---------- */
const ground = JSON.parse((await ev(`(() => {
  const g = window.__game;
  g.TUNE.spreadChancePerSec = 0;         // 关掉蔓延，避免干扰
  const fire = g.fires[0];
  const fp = fire.burn.rig.group.position;
  // 在火边放一份没人拿的食材
  g.openBox(g.boxes[0]);
  const food = g.foods[g.foods.length - 1];
  food.mesh.position.set(fp.x + 0.45, 0.3, fp.z + 0.45);
  food.cook = 0;
  return JSON.stringify({ cook0: +food.cook.toFixed(2), foods: g.foods.length });
})()`)).value);
await waitFor(`(function(){ const f = window.__game.foods[window.__game.foods.length-1]; return f && f.cook > 0.02; })()`, 20000);
const ground2 = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const f = g.foods[g.foods.length - 1];
  return JSON.stringify({ cook: +f.cook.toFixed(2) });
})()`)).value);
check("地上的食材被附近的火烤熟", ground2.cook > ground.cook0, `cook ${ground.cook0} → ${ground2.cook}`);

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
