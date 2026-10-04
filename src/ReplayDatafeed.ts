// ReplayDatafeed — bar replay over a fixed series (TradingView "Bar Replay").
// Only bars up to the cursor exist as far as the chart is concerned:
// getBars/getRange are clipped to the cursor, and play()/step() push newly
// revealed bars through subscribe() — the same path a live feed uses, so the
// chart, indicators and TradeLayer annotations all advance bar by bar.
//
// Seeking backwards can't be expressed as a live update, so seek() fires
// onSeek; `attachReplay(chart, replay)` wires that to chart.refresh().

import type { Datafeed } from "./adapters";
import type { Bar, Period, ReplayState, Unsubscribe } from "./types";
import { sliceRange, lowerBound } from "./StaticDatafeed";

export interface ReplayOptions {
  /** Index (or timestamp, if > bars.length) of the first revealed bar. Default: 0. */
  start?: number;
  /** Bars per second while playing. Default: 10. */
  speed?: number;
}

const FRAME_MS = 50; // timer resolution; high speeds reveal several bars per frame

export class ReplayDatafeed implements Datafeed {
  private bars: Bar[];
  private cursor: number;
  private speed: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private carry = 0; // fractional bars owed between frames
  private barListeners = new Set<(bar: Bar) => void>();
  private stateListeners = new Set<(s: ReplayState) => void>();
  private seekListeners = new Set<() => void>();

  constructor(bars: Bar[], opts: ReplayOptions = {}) {
    this.bars = [...bars].sort((a, b) => a.ts - b.ts);
    this.cursor = this.toIndex(opts.start ?? 0);
    this.speed = opts.speed ?? 10;
  }

  // ---- Datafeed (symbol/period ignored: a replay is one series)
  async getBars(_s: string, _p: Period, from: number, to: number): Promise<Bar[]> {
    if (!this.bars.length) return [];
    return sliceRange(this.bars, from, Math.min(to, this.bars[this.cursor].ts));
  }
  subscribe(_s: string, _p: Period, onBar: (bar: Bar) => void): Unsubscribe {
    this.barListeners.add(onBar);
    return () => { this.barListeners.delete(onBar); };
  }
  getRange(): { from: number; to: number } | null {
    return this.bars.length ? { from: this.bars[0].ts, to: this.bars[this.cursor].ts } : null;
  }

  // ---- Controls
  get state(): ReplayState {
    return { index: this.cursor, total: this.bars.length, ts: this.bars[this.cursor]?.ts ?? 0, playing: this.timer != null, speed: this.speed };
  }
  play(): void {
    if (this.timer || this.cursor >= this.bars.length - 1) return;
    this.carry = 0;
    this.timer = setInterval(() => {
      this.carry += (this.speed * FRAME_MS) / 1000;
      const n = Math.floor(this.carry);
      if (n > 0) { this.carry -= n; this.step(n); }
    }, FRAME_MS);
    this.emitState();
  }
  pause(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.emitState();
  }
  toggle(): void { if (this.timer) this.pause(); else this.play(); }
  setSpeed(barsPerSecond: number): void { this.speed = Math.max(0.1, barsPerSecond); this.emitState(); }

  /** Reveal the next `n` bars (pushed to subscribers in order). Auto-pauses at the end. */
  step(n = 1): void {
    const target = Math.min(this.bars.length - 1, this.cursor + Math.max(1, n));
    while (this.cursor < target) {
      this.cursor++;
      const bar = this.bars[this.cursor];
      for (const l of this.barListeners) l(bar);
    }
    if (this.cursor >= this.bars.length - 1) this.pause();
    this.emitState();
  }
  /** Jump to a bar index, or a timestamp (any value > bars.length is treated as ms epoch). */
  seek(indexOrTs: number): void {
    this.cursor = this.toIndex(indexOrTs);
    for (const l of this.seekListeners) l();
    this.emitState();
  }
  dispose(): void { this.pause(); this.barListeners.clear(); this.stateListeners.clear(); this.seekListeners.clear(); }

  onState(cb: (s: ReplayState) => void): Unsubscribe { this.stateListeners.add(cb); return () => { this.stateListeners.delete(cb); }; }
  onSeek(cb: () => void): Unsubscribe { this.seekListeners.add(cb); return () => { this.seekListeners.delete(cb); }; }

  private emitState(): void { const s = this.state; for (const l of this.stateListeners) l(s); }
  private toIndex(v: number): number {
    if (!this.bars.length) return 0;
    const i = v > this.bars.length ? lowerBound(this.bars, v) : Math.floor(v);
    return Math.max(0, Math.min(this.bars.length - 1, i));
  }
}

/** Keep a chart in step with a replay's seeks (forward play needs no wiring — it rides subscribe). */
export function attachReplay(chart: { refresh(): Promise<void> }, replay: ReplayDatafeed): Unsubscribe {
  return replay.onSeek(() => { void chart.refresh(); });
}
