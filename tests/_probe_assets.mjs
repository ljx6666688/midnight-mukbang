// 体检：打开一个地址，把 404 的请求、JS 异常、console 报错全都抓出来
// 用法: node _probe_assets.mjs <调试端口> <要打开的地址>
const PORT = process.argv[2] || "9333";
const URL_TO_OPEN = process.argv[3] || "http://127.0.0.1:8123/";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map();
const failed = []; const errors = []; const consoleErrs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.responseReceived") {
    const r = m.params.response;
    if (r.status >= 400) failed.push(`${r.status} ${r.url}`);
  }
  if (m.method === "Network.loadingFailed") failed.push(`FAILED ${m.params.errorText} (${m.params.type})`);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    consoleErrs.push(m.params.type + ": " + m.params.args.map(a => a.value ?? a.description).join(" "));
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    consoleErrs.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
  }
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Network.enable");
await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");
await send("Page.navigate", { url: URL_TO_OPEN });
for (let i = 0; i < 80; i++) { await sleep(250); if (await ev("!!window.__game")) break; }
await sleep(2000);
const ok = await ev("!!window.__game");
console.log("目标地址: " + URL_TO_OPEN);
console.log("游戏对象就绪: " + ok);
console.log("\n--- 404 / 加载失败的请求 ---");
console.log(failed.length ? failed.join("\n") : "（没有）");
console.log("\n--- JS 异常 ---");
console.log(errors.length ? errors.join("\n") : "（没有）");
console.log("\n--- console 错误/警告 ---");
console.log(consoleErrs.length ? consoleErrs.join("\n") : "（没有）");
process.exit(0);
