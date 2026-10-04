// Backtest view demo — BacktestView (the component the Jupyter widget mounts)
// over synthetic NIFTY-like 1m sessions with simulated trades. No backend.

import { BacktestView, type Bar, type LevelLine, type Marker, type TradePosition } from "tickline";

const DAY = 86_400_000;
const IST = 19_800_000; // +05:30

function generate(sessions: number, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bars: Bar[] = [];
  let px = 22000;
  const d0 = Date.UTC(2025, 0, 6);
  for (let d = 0, made = 0; made < sessions; d++) {
    const dow = new Date(d0 + d * DAY).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    made++;
    for (let m = 0; m < 375; m++) { // 09:15–15:29 IST = 03:45–09:59 UTC
      const ts = d0 + d * DAY + (225 + m) * 60_000;
      const open = px, close = open + (rnd() - 0.5) * 12;
      bars.push({ ts, open, close, high: Math.max(open, close) + rnd() * 5, low: Math.min(open, close) - rnd() * 5, volume: 0 });
      px = close;
    }
  }

  // PDH / PDL across each following session
  const days = new Map<number, Bar[]>();
  for (const b of bars) { const k = Math.floor((b.ts + IST) / DAY); (days.get(k) ?? days.set(k, []).get(k)!).push(b); }
  const sessionsList = [...days.values()];
  const levels: LevelLine[] = [];
  for (let i = 1; i < sessionsList.length; i++) {
    const prev = sessionsList[i - 1], cur = sessionsList[i];
    const span = { fromTs: cur[0].ts, toTs: cur[cur.length - 1].ts };
    levels.push({ ...span, price: Math.max(...prev.map((b) => b.high)), label: "PDH", color: "#f59e0b" });
    levels.push({ ...span, price: Math.min(...prev.map((b) => b.low)), label: "PDL", color: "#38bdf8" });
  }

  // simulated trades: alternate long/short, 15pt stop, 2R target, 50-bar time stop
  const positions: TradePosition[] = [];
  const markers: Marker[] = [];
  for (let i = 400; i < bars.length - 60; i += 211) {
    const long = Math.floor(i / 211) % 2 === 0;
    const entry = bars[i].close, stop = long ? entry - 15 : entry + 15, target = long ? entry + 30 : entry - 30;
    let j = i + 1, exit = bars[i + 50].close;
    for (; j < i + 50; j++) {
      const b = bars[j];
      if (long ? b.low <= stop : b.high >= stop) { exit = stop; break; }
      if (long ? b.high >= target : b.low <= target) { exit = target; break; }
    }
    const win = (long ? exit - entry : entry - exit) >= 0;
    positions.push({ side: long ? "long" : "short", entryTs: bars[i].ts, entryPrice: entry, stopPrice: stop, targetPrice: target, exitTs: bars[j].ts, exitPrice: exit, label: "demo" });
    markers.push({ ts: bars[i].ts, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", text: long ? "Buy" : "Sell" });
    markers.push({ ts: bars[j].ts, position: long ? "aboveBar" : "belowBar", shape: long ? "arrowDown" : "arrowUp", text: "Exit", color: win ? "#26a69a" : "#ef5350" });
  }
  return { bars, levels, positions, markers };
}

const data = generate(40);
const view = new BacktestView(document.getElementById("view")!, {
  ...data,
  symbol: "NIFTY",
  title: "NIFTY 1m · synthetic backtest",
  timezone: "Asia/Kolkata",
  height: Math.max(420, window.innerHeight - 70),
  speed: 20,
});
(window as unknown as { view: BacktestView }).view = view; // poke at it from devtools
