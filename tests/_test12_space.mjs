// 连通性检查：从出生点出发，能不能走到各个关键位置（网格 BFS，考虑玩家半径）
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
await sleep(3800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(500);

let fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  " + d : ""}`); if (!ok) fail++; };

const result = JSON.parse((await ev(`(() => {
  const g = window.__game;
  const STEP = 0.2, LIM = 4.6;
  const N = Math.round((LIM * 2) / STEP) + 1;
  const idx = (i, j) => i * N + j;
  const toWorld = (i) => -LIM + i * STEP;

  // 1. 标记每个格子能否站人
  const free = new Uint8Array(N * N);
  let freeCount = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const ok = !g.playerCollide(toWorld(i), toWorld(j), 0) ? 1 : 0;
      free[idx(i, j)] = ok;
      freeCount += ok;
    }
  }

  // 2. 从出生点 BFS
  const startI = Math.round((0 + LIM) / STEP);
  const startJ = Math.round((4.2 + LIM) / STEP);
  const seen = new Uint8Array(N * N);
  const q = [idx(startI, startJ)];
  seen[q[0]] = 1;
  while (q.length) {
    const cur = q.pop();
    const i = Math.floor(cur / N), j = cur % N;
    const nb = [[i+1,j],[i-1,j],[i,j+1],[i,j-1]];
    for (const [a, b] of nb) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const k = idx(a, b);
      if (seen[k] || !free[k]) continue;
      seen[k] = 1;
      q.push(k);
    }
  }

  const reach = (x, z) => {
    const i = Math.round((x + LIM) / STEP);
    const j = Math.round((z + LIM) / STEP);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return !!seen[idx(i, j)];
  };

  const points = {
    "出生点": [0, 4.2],
    "房间中央偏前": [0, 2.6],
    "餐桌左侧": [-1.6, 0.4],
    "餐桌右侧": [1.6, 0.4],
    "门口": [3.6, -1.6],
    "门口正前": [4.2, -2.2],
    "水槽前": [-2.5, 0.6],
    "沙发前": [-3.4, 3.2],
    "电视前": [2.4, 3.4],
    "四个角落": null
  };
  const out = {};
  for (const k in points) {
    if (!points[k]) continue;
    out[k] = reach(points[k][0], points[k][1]);
  }
  // 角落单独算
  out["左下角"] = reach(-4.0, -4.0);
  out["右下角"] = reach(4.0, -4.0);
  out["后墙中央"] = reach(0, 4.3);
  out["沙发与桌之间"] = reach(-2.6, 2.0);

  let reachCount = 0;
  for (let k = 0; k < seen.length; k++) if (seen[k]) reachCount++;

  return JSON.stringify({
    freePct: +(freeCount / (N * N) * 100).toFixed(1),
    reachPctOfFree: +(reachCount / Math.max(1, freeCount) * 100).toFixed(1),
    points: out
  }, null, 1);
})()`)).value);

check("可走面积 ≥ 70%", result.freePct >= 70, `${result.freePct}%`);
check("可走区域从出生点全部连通", result.reachPctOfFree >= 98, `可达 ${result.reachPctOfFree}%`);
const unreachable = Object.entries(result.points).filter(([, v]) => !v).map(([k]) => k);
check("各个关键位置都能走到", unreachable.length === 0, unreachable.length ? "走不到：" + unreachable.join("、") : Object.keys(result.points).join("、"));

console.log(errors.length ? "\n报错: " + errors.slice(0, 5).join("\n") : "\n无报错");
ws.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
