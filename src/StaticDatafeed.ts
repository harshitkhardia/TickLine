// StaticDatafeed — an in-memory, BOUNDED Datafeed over pre-loaded bars
// (backtests, notebooks, fixtures). Serves windows by binary search, so a
// 150k-bar 1m history is handed to the chart one 7-day page at a time: the
// chart opens at the data's end (getRange) and pages older/newer bars on scroll.

import type { Datafeed } from "./adapters";
import type { Bar, Period, Unsubscribe } from "./types";

/** Columnar bars (numpy/pandas-friendly). `ts` is ms epoch UTC. */
export interface BarColumns {
  ts: ArrayLike<number>;
  open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>;
  volume?: ArrayLike<number>;
}

export function barsFromColumns(c: BarColumns): Bar[] {
  const n = c.ts.length;
  const out: Bar[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { ts: c.ts[i], open: c.open[i], high: c.high[i], low: c.low[i], close: c.close[i], volume: c.volume ? c.volume[i] : 0 };
  }
  return out;
}

/** First index with bars[i].ts >= ts (bars.length if none). */
export function lowerBound(bars: Bar[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].ts < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Bars with from <= ts <= to (inclusive), assuming ascending ts. */
export function sliceRange(bars: Bar[], from: number, to: number): Bar[] {
  if (to < from) return [];
  return bars.slice(lowerBound(bars, from), lowerBound(bars, to + 1));
}

const key = (symbol: string, period: Period) => `${symbol}|${period}`;

export class StaticDatafeed implements Datafeed {
  private data = new Map<string, Bar[]>();

  /** Load (or replace) the bars for a symbol/period. Sorted ascending; duplicate ts keep the last. */
  set(symbol: string, period: Period, bars: Bar[] | BarColumns): this {
    const arr = Array.isArray(bars) ? [...bars] : barsFromColumns(bars);
    arr.sort((a, b) => a.ts - b.ts);
    const dedup: Bar[] = [];
    for (const b of arr) {
      if (dedup.length && dedup[dedup.length - 1].ts === b.ts) dedup[dedup.length - 1] = b;
      else dedup.push(b);
    }
    this.data.set(key(symbol, period), dedup);
    return this;
  }
  get(symbol: string, period: Period): Bar[] { return this.data.get(key(symbol, period)) ?? []; }

  async getBars(symbol: string, period: Period, from: number, to: number): Promise<Bar[]> {
    return sliceRange(this.get(symbol, period), from, to);
  }
  subscribe(): Unsubscribe { return () => {}; } // static: no live tail
  getRange(symbol: string, period: Period): { from: number; to: number } | null {
    const bars = this.get(symbol, period);
    return bars.length ? { from: bars[0].ts, to: bars[bars.length - 1].ts } : null;
  }
}
