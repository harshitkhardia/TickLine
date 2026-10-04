// MockDatafeed — self-contained in-memory random walk. No backend required.
// Used as a fallback (VITE_USE_MOCK=1) so the demo runs standalone / in CI.
// Always marks data as synthetic via onMockFlag(true).

import type { Datafeed } from "tickline";
import { type Bar, type Period, type Unsubscribe } from "tickline";

const PERIOD_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "1h": 3_600_000, "1d": 86_400_000,
};

// Mulberry32 — tiny deterministic PRNG so the mock chart is stable per symbol.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genBars(symbol: string, period: Period, from: number, to: number): Bar[] {
  const step = PERIOD_MS[period] ?? PERIOD_MS["5m"];
  const seed = Array.from(symbol).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const rand = rng(seed);
  const bars: Bar[] = [];
  let price = 20000 + Math.floor(rand() * 5000);
  // align the first bucket
  let t = Math.floor(from / step) * step;
  for (; t < to; t += step) {
    const drift = (rand() - 0.5) * price * 0.004;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + rand() * 0.002);
    const low = Math.min(open, close) * (1 - rand() * 0.002);
    const volume = 1000 + Math.floor(rand() * 9000);
    bars.push({ ts: t, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

export function createMockDatafeed(): Datafeed {
  return {
    async getBars(symbol, period, from, to) {
      await new Promise((r) => setTimeout(r, 60)); // simulate latency
      return genBars(symbol, period, from, to);
    },
    subscribe(symbol, period, onBar) {
      const step = PERIOD_MS[period] ?? PERIOD_MS["5m"];
      let price = 22000;
      const timer = setInterval(() => {
        const now = Date.now();
        const bucket = Math.floor(now / step) * step;
        const drift = (Math.random() - 0.5) * price * 0.003;
        const close = Math.max(1, price + drift);
        const open = price;
        const bar: Bar = {
          ts: bucket, open, high: Math.max(open, close), low: Math.min(open, close),
          close, volume: 500 + Math.floor(Math.random() * 1500),
        };
        onBar(bar);
        price = close;
      }, 1000);
      return (() => clearInterval(timer)) as Unsubscribe;
    },
  };
}
