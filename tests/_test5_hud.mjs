// 第四轮：呼吸回血 + 底部血条
import fs from "node:fs";
const PORT = process.argv[2] || "9333";
const SHOT = process.argv[3] || "C:\\Users\\liuji\\Desktop\\111\\game\\_hud.png";
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
await sleep(3800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(600);

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 受伤后延迟 2 秒才回血
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, 1.62, 3.5);
  g.state.hp = 50;
  g.state.lastHurt = g.state.time;   // 刚刚才受过伤
})()`);
await sleep(900);
const early = JSON.parse((await ev(`JSON.stringify({ hp: +window.__game.state.hp.toFixed(1) })`)).value);
check("受伤后 0.9 秒内不立刻回血", early.hp <= 50.5, `hp=${early.hp}`);

await sleep(2600);
const later = JSON.parse((await ev(`JSON.stringify({ hp: +window.__game.state.hp.toFixed(1) })`)).value);
check("脱离火源约 3.5 秒后开始回血", later.hp > 50.5, `hp=${later.hp}`);

// 低血量告警样式
await ev(`window.__game.state.hp = 20`);
await sleep(400);
const low = JSON.parse((await ev(`JSON.stringify({
  low: document.getElementById('healthHud').classList.contains('low'),
  width: document.getElementById('healthFill').style.width,
  hudBottom: getComputedStyle(document.getElementById('healthHud')).bottom,
  hudCenter: getComputedStyle(document.getElementById('healthHud')).left
})`)).value);
check("血量 20 时血条进入告警状态", low.low === true, JSON.stringify(low));
check("血条在屏幕下方居中", low.hudBottom === "22px", `bottom=${low.hudBottom}, left=${low.hudCenter}`);

// 回血生效中，图标状态
await ev(`window.__game.state.lastHurt = -99`);
await sleep(500);
const regenClass = await ev(`document.getElementById('healthHud').classList.contains('regen')`);
check("回血过程中心形变色", regenClass.value === true);

// 赞助海报已移除：场景里不应再有带「大肥鱼」的贴图
const poster = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ removed: !('texPoster' in g) });
})()`)).value);
check("旧赞助海报贴图已废弃", poster.removed === true, JSON.stringify(poster));

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
if (shot.result?.data) { fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64")); console.log("截图:", SHOT); }

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
