// 输入方式自动识别 + 手动切换 的验证
//  1) 电脑（无触屏）      → 键鼠操作，不出现摇杆按钮
//  2) Windows 触屏笔记本  → 仍然键鼠操作（不误判）
//  3) 手机（粗指针+触屏） → 触屏操作，出现摇杆按钮
//  4) 手动切换胶囊 / T 键 → 立即生效并被记住
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
let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

const waitBoot = async () => {
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const r = await send("Runtime.evaluate", { expression: "!!window.__game", returnByValue: true });
    if (r.result?.result?.value === true) { await sleep(400); return true; }
  }
  return false;
};
const reload = async () => { await send("Page.reload", { ignoreCache: true }); return waitBoot(); };

// 界面状态快照
const uiState = () => ev(`(() => {
  const joy = document.getElementById("joy");
  const tui = document.getElementById("touchUI");
  const chip = document.getElementById("inputModeBtn");
  const jr = joy.getBoundingClientRect();
  return JSON.stringify({
    isTouch: window.__game.isTouch,
    mode: window.__game.inputMode(),
    bodyTouch: document.body.classList.contains("touch"),
    touchUIDisplay: getComputedStyle(tui).display,
    joyBox: Math.round(jr.width) + "x" + Math.round(jr.height),
    chip: (chip.textContent || "").trim(),
    saved: localStorage.getItem("mukbang.inputMode"),
    quality: window.__game.quality()
  });
})()`);

await send("Runtime.enable"); await send("Page.enable");
await ev(`window.__game && window.__game.clearInputModeOverride()`);
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
if (!await reload()) { console.log("FAIL 页面没起来"); process.exit(1); }

/* ---------- 1. 普通电脑 ---------- */
console.log("\n[1] 普通电脑（无触屏）");
let s = JSON.parse(await uiState());
check("识别为键鼠操作", s.isTouch === false && s.mode === "desktop", `isTouch=${s.isTouch} mode=${s.mode}`);
check("没有 .touch 类", s.bodyTouch === false);
check("触屏 UI 被隐藏", s.touchUIDisplay === "none", "display=" + s.touchUIDisplay);
check("摇杆尺寸为 0（看不见也点不到）", s.joyBox === "0x0", s.joyBox);
check("胶囊显示「键鼠操作」", /键鼠/.test(s.chip), s.chip);
check("画质默认中档", s.quality === 1, "quality=" + s.quality);
check("识别依据正确", await ev(`(() => { const e = window.__game.readInputEnv(); return e.touchPoints === 0 && e.fine === true; })()`));

/* ---------- 2. Windows 触屏笔记本：有触屏，但主指针是鼠标/触控板 ---------- */
console.log("\n[2] 触屏笔记本（有触屏 + 鼠标/触控板）");
const stubId = (await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const orig = window.matchMedia.bind(window);
    const mk = (m) => ({ matches: m, media: "", onchange: null,
      addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
    window.matchMedia = (q) => {
      const s = String(q).replace(/\\s+/g, "").toLowerCase();
      if (s === "(pointer:fine)") return mk(true);
      if (s === "(pointer:coarse)") return mk(false);
      if (s === "(hover:hover)") return mk(true);
      if (s === "(hover:none)") return mk(false);
      if (s === "(any-pointer:coarse)") return mk(true);
      if (s === "(any-pointer:fine)") return mk(true);
      return orig(q);
    };
  })();`
})).result.identifier;
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 10 });
await reload();
s = JSON.parse(await uiState());
const touchPoints = await ev(`navigator.maxTouchPoints`);
check("确实报告有触屏", touchPoints > 0, "maxTouchPoints=" + touchPoints);
check("主指针是鼠标 → 仍走键鼠", s.isTouch === false && s.mode === "desktop", `isTouch=${s.isTouch}`);
check("摇杆依然不出现", s.touchUIDisplay === "none" && s.joyBox === "0x0", s.touchUIDisplay + " / " + s.joyBox);
// 手指真的戳屏幕时，提示胶囊会闪
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 400, y: 300 }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(300);
check("戳屏幕后切换胶囊给出提示", await ev(`document.getElementById("inputModeBtn").classList.contains("notice")`));
// 手动切成触屏：进入触屏模式，开播后摇杆就应该出现
await ev(`window.__game.setInputMode("touch")`);
await sleep(300);
check("手动切成触屏后进入触屏模式", await ev(`window.__game.isTouch && document.body.classList.contains("touch")`));
await ev(`document.getElementById("startBtn").click()`);
await sleep(1200);
check("开播后摇杆出现", (await ev(`getComputedStyle(document.getElementById("touchUI")).display`)) !== "none"
  && (await ev(`document.getElementById("joy").getBoundingClientRect().width`)) > 0);
await ev(`window.__game.setInputMode("desktop")`);
await sleep(250);
check("切回键鼠后摇杆立刻消失", (await ev(`getComputedStyle(document.getElementById("touchUI")).display`)) === "none");
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: stubId });

/* ---------- 3. 手机 ---------- */
console.log("\n[3] 手机（粗指针 + 触屏）");
await ev(`window.__game.clearInputModeOverride()`);
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36" });
await reload();
s = JSON.parse(await uiState());
check("识别为触屏操作", s.isTouch === true && s.mode === "touch", `isTouch=${s.isTouch}`);
check("未开播时控件先收起", s.bodyTouch === true && s.touchUIDisplay === "none", "display=" + s.touchUIDisplay);
check("胶囊显示「触屏操作」", /触屏/.test(s.chip), s.chip);
check("手机自动降画质", s.quality === 2, "quality=" + s.quality);
check("识别依据：主指针是手指", await ev(`(() => { const e = window.__game.readInputEnv(); return e.coarse === true && e.fine === false; })()`));

/* ---------- 4. 手动切换 + 记忆 ---------- */
console.log("\n[4] 手动切换与记忆");
await ev(`document.getElementById("inputModeBtn").click()`);
await sleep(350);
s = JSON.parse(await uiState());
check("点胶囊 → 切成键鼠", s.isTouch === false && s.touchUIDisplay === "none", `mode=${s.mode}`);
check("选择被记住", s.saved === "desktop", "saved=" + s.saved);
await reload();
s = JSON.parse(await uiState());
check("重开页面仍是键鼠（记住上次选择）", s.isTouch === false && s.saved === "desktop");
// T 键切回触屏
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "t", code: "KeyT", windowsVirtualKeyCode: 84, nativeVirtualKeyCode: 84, text: "t" });
await sleep(400);
s = JSON.parse(await uiState());
check("T 键切回触屏", s.isTouch === true && s.saved === "touch", `mode=${s.mode} saved=${s.saved}`);
// 清掉记忆 → 回到自动识别
await ev(`window.__game.clearInputModeOverride()`);
await reload();
s = JSON.parse(await uiState());
check("清掉记忆后恢复自动识别（手机仍触屏）", s.isTouch === true && s.saved === null, `saved=${s.saved}`);

/* ---------- 5. 游戏本身还能玩 ---------- */
console.log("\n[5] 触屏模式下能正常开播");
await ev(`document.getElementById('startBtn').click()`);
await sleep(1300);
check("游戏已开始", await ev(`window.__game.state.running`) === true);
const joyBox = JSON.parse(await ev(`(() => { const r = document.getElementById("joy").getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
const z0 = await ev(`+window.__game.player.pos.z.toFixed(2)`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: joyBox.x, y: joyBox.y }] });
await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: joyBox.x, y: joyBox.y - 50 }] });
await sleep(900);
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const z1 = await ev(`+window.__game.player.pos.z.toFixed(2)`);
check("摇杆能走路", z1 < z0 - 1, `z ${z0} → ${z1}`);
check("无 JS 异常", errors.length === 0, errors.slice(0, 2).join(" | "));

// 收尾：清模拟 + 清记忆，别影响后面的测试
await ev(`window.__game.clearInputModeOverride()`);
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
await send("Emulation.setUserAgentOverride", { userAgent: "" });

console.log(fail === 0 ? "\n全部通过 ✅" : `\n${fail} 项失败 ❌`);
process.exit(fail === 0 ? 0 : 1);
