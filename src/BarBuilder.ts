// BarBuilder — tick → bar aggregation (kb/ARCHITECTURE.md §2, kb/API.md §8.5).
// Single period. Without a session: 24h-continuous boundaries (UTC floor). With
// `session`: buckets anchor at the session open via SessionClock (NSE 09:15 →
// 1h bars at 09:15/10:15/…, matching session-aligned /history candles). For
// many periods off one stream use MultiPeriodAggregator (D-CM3).

import type { Bar, Period, SessionSpec } from "./types";
import { periodToMs, SessionClock } from "./session";

export interface Tick { ts: number; price: number; volume?: number; }
export interface BarBuilderOptions {
  timezone?: string;
  /** Anchor buckets at this session's open instead of UTC midnight. */
  session?: SessionSpec;
}

export class BarBuilder {
  private readonly stepMs: number;
  private readonly clock: SessionClock;
  private current: Bar | null = null;

  constructor(period: Period, opts: BarBuilderOptions = {}) {
    // Arbitrary integer periods now parse (D-CM3); garbage still throws.
    this.stepMs = periodToMs(period);
    this.clock = new SessionClock(opts.session); // no session → UTC floor
  }

  /** Push a tick; returns the current (updating) bar. Rolls a new bar at each boundary. */
  push(tick: Tick): Bar {
    const bucket = this.clock.bucketOf(tick.ts, this.stepMs);
    const vol = tick.volume ?? 0;
    if (!this.current || this.current.ts !== bucket) {
      this.current = {
        ts: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: vol,
      };
    } else {
      this.current.high = Math.max(this.current.high, tick.price);
      this.current.low = Math.min(this.current.low, tick.price);
      this.current.close = tick.price;
      this.current.volume += vol;
    }
    return this.current;
  }

  /** The bar currently being built, or null before the first tick. */
  peek(): Bar | null { return this.current; }
}
