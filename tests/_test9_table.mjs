// 验证：能跳上餐桌；并且画质档位可切换
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
await sleep(600);

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

// 1. 从桌面上方落下，应该停在桌面上而不是穿过去
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight + 1.5, 0.4); g.player.feet = 1.5;   // 桌子中心正上方
  g.player.yaw = 0;
  g.player.vy = 0;
})()`);
await sleep(1200);
const onTable = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    feet: +g.player.feet.toFixed(2),
    onGround: g.player.onGround,
    x: +g.player.pos.x.toFixed(2),
    z: +g.player.pos.z.toFixed(2)
  });
})()`)).value);
check("落在餐桌面并站住（桌面 0.86 米）", onTable.feet > 0.7 && onTable.onGround === true, JSON.stringify(onTable));

// 2. 助跑起跳，应该能落到桌面上（这正是玩家要的"跳到桌子上"）
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight, 1.9); g.player.feet = 0; g.player.feet = 0;
  g.player.yaw = 0;
  g.player.vy = 0;
})()`);
await sleep(250);
await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
await keyDown("w", "KeyW", 87);
await sleep(420);
await keyUp("w", "KeyW", 87);
await sleep(800);
const jumpOn = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    feet: +g.player.feet.toFixed(2),
    z: +g.player.pos.z.toFixed(2),
    onGround: g.player.onGround
  });
})()`)).value);
check("助跑起跳能跳上餐桌", jumpOn.feet > 0.7 && jumpOn.onGround === true, JSON.stringify(jumpOn));

// 3. 从桌面上再起跳，应该能越过桌子落到另一侧
await ev(`(() => {
  const g = window.__game;
  g.player.pos.set(0, g.TUNE.eyeHeight + 0.86, 0.8); g.player.feet = 0.86;
  g.player.yaw = 0;
  g.player.vy = 0;
})()`);
await sleep(250);
await keyDown(" ", "Space", 32); await keyUp(" ", "Space", 32);
await keyDown("w", "KeyW", 87);
await sleep(600);
await keyUp("w", "KeyW", 87);
await sleep(900);
const crossed = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ z: +g.player.pos.z.toFixed(2), feet: +g.player.feet.toFixed(2) });
})()`)).value);
check("从桌上再起跳能越过桌子落地", crossed.z < -0.3 && crossed.feet < 0.2, JSON.stringify(crossed));

// 走到桌边应该掉下来
await keyDown("s", "KeyS", 83); await sleep(600); await keyUp("s", "KeyS", 83);
await sleep(700);
const offTable = JSON.parse((await ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ feet: +g.player.feet.toFixed(2), onGround: g.player.onGround });
})()`)).value);
check("走出桌边会掉回地面", offTable.feet < 0.2, JSON.stringify(offTable));

// 画质档位切换
const q0 = JSON.parse((await ev(`JSON.stringify({ ratio: window.__game.renderer.getPixelRatio(), shadows: window.__game.renderer.shadowMap.enabled })`)).value);
await ev(`window.__game.applyQuality(2, true)`);
await sleep(400);
const q2 = JSON.parse((await ev(`JSON.stringify({ ratio: window.__game.renderer.getPixelRatio(), shadows: window.__game.renderer.shadowMap.enabled })`)).value);
check("画质可切到低档（关阴影、降分辨率）", q2.shadows === false && q2.ratio <= 1.01, `中 ${JSON.stringify(q0)} → 低 ${JSON.stringify(q2)}`);

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
