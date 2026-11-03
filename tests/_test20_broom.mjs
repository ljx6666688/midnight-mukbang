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

// 造两处灰烬，站在其中一处前面
const setup = JSON.parse((await ev(`(() => {
  const g = window.__game;
  g.TUNE.parcelInterval = 1e9;
  for (const b of [...g.boxes]) { g.world.removeBody(b.pbody); b.group.parent.remove(b.group); }
  g.boxes.length = 0;
  g.spawnAshPile(0, -1.4, 0.9);
  g.spawnAshPile(2.0, -1.4, 0.9);
  g.player.pos.set(0, g.TUNE.eyeHeight, 0.2);
  g.player.feet = 0;
  g.player.yaw = 0;      // 朝 -z
  g.player.pitch = -0.3;
  g.setTool("broom");
  return JSON.stringify({ ash: g.ashCount(), tool: g.state.tool, money: g.state.money });
})()`)).value);
check("扫帚工具可切换", setup.tool === "broom", JSON.stringify(setup));
check("地上有两处灰烬", setup.ash === 2, `灰烬 ${setup.ash}`);

// 扫掉面前的一处
await ev(`(() => { window.__game.useTool(); })()`);
await sleep(900);
const after = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ ash: g.ashCount(), money: g.state.money, swinging: g.broomSwinging() });
})()`)).value);
check("扫帚扫掉了一处灰烬", after.ash === 1, `灰烬 ${setup.ash} → ${after.ash}`);
check("扫灰有打赏收益", after.money === setup.money + 10, `余额 ${setup.money} → ${after.money}`);

// 背对着另一处扫（应该扫不到）
await ev(`(() => { const g = window.__game; g.player.yaw = Math.PI; })()`);
await sleep(300);
await ev(`(() => { window.__game.useTool(); })()`);
await sleep(600);
const wrongWay = JSON.parse((await ev(`JSON.stringify({ ash: window.__game.ashCount() })`)).value);
check("背对灰烬时扫不到", wrongWay.ash === 1, `灰烬 ${wrongWay.ash}`);

console.log(errors.length ? "报错: " + errors.join("\n") : "无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
