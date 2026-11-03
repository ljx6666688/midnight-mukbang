const PORT = process.argv[2] || "9333";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page" && /index\.html/.test(t.url)) || list.find(t => t.type === "page" && /^file:/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts });

await send("Runtime.enable"); await send("Page.enable");
// 模拟手机（横屏 844x390、DPR2、支持触摸）
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36" });
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60; i++) { await sleep(300); const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true }); if (r.result?.result?.value === true) break; }
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

check("识别为触屏设备", await ev(`window.__game.isTouch`) === true, "isTouch=" + (await ev(`window.__game.isTouch`)));
check("自动降画质", await ev(`window.__game.quality()`) === 2, "quality=" + (await ev(`window.__game.quality()`)));
check("触屏 UI 显示", await ev(`document.body.classList.contains('touch') && getComputedStyle(document.getElementById('touchUI')).display !== 'none'`));

// 开始游戏
await ev(`document.getElementById('startBtn').click()`);
await sleep(1200);
check("游戏已开始", await ev(`window.__game.state.running`) === true);

// 摇杆：按住向上推 → 应该前进（z 变小）
const before = await ev(`JSON.stringify({ x: +window.__game.player.pos.x.toFixed(2), z: +window.__game.player.pos.z.toFixed(2) })`);
const joyBox = JSON.parse(await ev(`(() => { const r = document.getElementById('joy').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
await touch("touchStart", [{ x: joyBox.x, y: joyBox.y }]);
await touch("touchMove", [{ x: joyBox.x, y: joyBox.y - 50 }]);
await sleep(700);
const movedState = await ev(`JSON.stringify({ w: !!window.__game.keys.w, z: +window.__game.player.pos.z.toFixed(2) })`);
await touch("touchEnd", []);
await sleep(200);
const after = await ev(`JSON.stringify({ x: +window.__game.player.pos.x.toFixed(2), z: +window.__game.player.pos.z.toFixed(2) })`);
const b = JSON.parse(before), a = JSON.parse(after);
check("摇杆能前进", JSON.parse(movedState).w === true && a.z < b.z - 0.3, `z ${b.z} → ${a.z}`);

// 视角滑动
const yaw0 = await ev(`+window.__game.player.yaw.toFixed(3)`);
await touch("touchStart", [{ x: 500, y: 200 }]);
await touch("touchMove", [{ x: 400, y: 200 }]);
await touch("touchEnd", []);
await sleep(200);
const yaw1 = await ev(`+window.__game.player.yaw.toFixed(3)`);
check("滑动能转视角", Math.abs(yaw1 - yaw0) > 0.1, `yaw ${yaw0} → ${yaw1}`);

// 跳跃按钮
await ev(`document.getElementById('btnJump').dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))`);
await sleep(250);
const jumped = await ev(`+(window.__game.player.pos.y - window.__game.TUNE.eyeHeight).toFixed(2)`);
check("跳跃按钮生效", jumped > 0.05, `离地 ${jumped} 米`);

// 换工具按钮
const tool0 = await ev(`window.__game.state.tool`);
await ev(`document.getElementById('btnTool').dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))`);
await sleep(300);
const tool1 = await ev(`window.__game.state.tool`);
check("换工具按钮生效", tool1 !== tool0, `${tool0} → ${tool1}`);

// 触屏不应触发指针锁定
await ev(`document.querySelector('canvas').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(300);
check("触屏不请求指针锁定", await ev(`document.pointerLockElement === null`));

console.log(errors.length ? "控制台报错: " + errors.slice(0,3).join(" | ") : "无控制台报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
