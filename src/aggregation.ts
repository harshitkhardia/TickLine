// MultiPeriodAggregator — one base stream → many timeframes (kb/CHARTMANAGER.md §3, D-CM2/D-CM3).
//
// The hybrid model:
//   • A higher-TF bar is ALWAYS fold(its constituent 1m bars). The last 1m may be
//     still-forming (tick-built) → the bar is provisional; once every 1m in the
//     bucket has closed → the bar is confirmed (1m-authoritative).
//   • Live forming edge is driven by ticks (fast). On close, the bar is folded from
//     closed 1m bars — so per-candle OHLCV matches the authoritative 1m (the Zerodha
//     finding: historical 1m is the authoritative volume source).
//   • push1mClose() lets an authoritative 1m feed correct a tick-built minute; the
//     affected higher-TF bucket re-emits (reconciliation) only if its values changed.
//
// Bucketing is session-anchored via SessionClock (arbitrary periods: 10m/17m/…).

import type { Bar, Period } from "./types";
import type { Tick } from "./BarBuilder";
import { SessionClock, periodToMs } from "./session";

const MIN_MS = 60_000;
const MIN_KEEP_MS = 86_400_000; // always retain a full session of 1m (seed + late-added daily TFs)

interface PeriodState { period: Period; ms: number; formingBucket: number | null; }
type CloseCb = (period: Period, bar: Bar) => void;

export class MultiPeriodAggregator {
  private readonly clock: SessionClock;
  private readonly states: PeriodState[];
  private keepMs = MIN_KEEP_MS;

  private spine = new Map<number, Bar>(); // CLOSED 1m bars, keyed by minute-bucket ts
  private forming1m: Bar | null = null;   // the live, tick-built 1m
  private closeSig = new Map<string, string>(); // `${period}@${bucket}` → signature (dedup / reconcile)
  private closeCbs: CloseCb[] = [];

  constructor(periods: Period[], clock: SessionClock = new SessionClock()) {
    this.clock = clock;
    this.states = periods.map((p) => ({ period: p, ms: periodToMs(p), formingBucket: null }));
    this.updateKeep();
  }

  /** Register a listener for confirmed (or reconciled) closed bars. */
  onClose(cb: CloseCb): void { this.closeCbs.push(cb); }

  /** Add a period after construction (a new chart subscribes a TF not seen yet). */
  addPeriod(period: Period): void {
    if (this.states.some((s) => s.period === period)) return;
    const ms = periodToMs(period);
    const anchor = this.forming1m?.ts ?? this.maxSpineTs();
    const formingBucket = anchor != null ? this.clock.bucketOf(anchor, ms) : null;
    this.states.push({ period, ms, formingBucket });
    this.updateKeep();
  }

  /** Bounded spine window: 3 buckets of the largest tracked period (>= one day). */
  private updateKeep(): void {
    const maxMs = Math.max(...this.states.map((s) => s.ms), MIN_MS);
    this.keepMs = Math.max(maxMs * 3, MIN_KEEP_MS);
  }

  /** True if the aggregator is already tracking this period. */
  hasPeriod(period: Period): boolean { return this.states.some((s) => s.period === period); }

  /** Push a whole live 1m bar (the base feed delivers 1m bars, not raw ticks).
   *  Mirrors pushTick but preserves the 1m OHLC. Rolls + closes on minute change. */
  pushForming1m(bar: Bar): Map<Period, Bar> {
    const m1 = this.clock.bucketOf(bar.ts, MIN_MS);
    if (this.forming1m && this.forming1m.ts !== m1) this.closeMinute(this.forming1m);
    this.forming1m = { ...bar, ts: m1 };
    this.advance(bar.ts);
    const out = new Map<Period, Bar>();
    for (const s of this.states) {
      const b = this.forming(s);
      if (b) out.set(s.period, b);
    }
    return out;
  }

  /** Seat the 1m spine after backfill (§2 seam). Does NOT emit closes for history. */
  seed1m(bars: Bar[]): void {
    for (const b of bars) {
      const ts = this.clock.bucketOf(b.ts, MIN_MS);
      this.spine.set(ts, { ...b, ts });
    }
    this.prune();
    const latest = this.maxSpineTs();
    if (latest != null) {
      for (const s of this.states) s.formingBucket = this.clock.bucketOf(latest, s.ms);
    }
  }

  /** Push a live tick; returns the current (forming) bar for every period. */
  pushTick(tick: Tick): Map<Period, Bar> {
    const m1 = this.clock.bucketOf(tick.ts, MIN_MS);
    if (!this.forming1m || this.forming1m.ts !== m1) {
      if (this.forming1m) this.closeMinute(this.forming1m); // roll: previous 1m becomes closed
      const v = tick.volume ?? 0;
      this.forming1m = { ts: m1, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: v };
    } else {
      const f = this.forming1m;
      f.high = Math.max(f.high, tick.price);
      f.low = Math.min(f.low, tick.price);
      f.close = tick.price;
      f.volume += tick.volume ?? 0;
    }
    this.advance(tick.ts);

    const out = new Map<Period, Bar>();
    for (const s of this.states) {
      const bar = this.forming(s);
      if (bar) out.set(s.period, bar);
    }
    return out;
  }

  /** Supply an authoritative closed 1m bar. Corrects tick-built minutes; reconciles
   *  the affected higher-TF bucket (re-emits onClose only if its values changed). */
  push1mClose(bar: Bar): void {
    const ts = this.clock.bucketOf(bar.ts, MIN_MS);
    this.spine.set(ts, { ...bar, ts });
    this.prune();
    for (const s of this.states) {
      const bp = this.clock.bucketOf(ts, s.ms);
      const isFinalMinute = ts + MIN_MS >= this.clock.closeOf(bp, s.ms);
      // close a past/complete bucket (reconcile), or one whose final minute just arrived
      if ((s.formingBucket != null && bp < s.formingBucket) || isFinalMinute) this.tryClose(s, bp);
    }
  }

  // ---- internals ------------------------------------------------------------

  /** Move a closed 1m into the spine and close any period bucket it completes. */
  private closeMinute(bar: Bar): void {
    this.spine.set(bar.ts, bar);
    this.prune();
    for (const s of this.states) {
      const bp = this.clock.bucketOf(bar.ts, s.ms);
      if (bar.ts + MIN_MS >= this.clock.closeOf(bp, s.ms)) this.tryClose(s, bp); // final minute of bucket
    }
  }

  /** Advance each period's forming bucket to `now`; close the bucket we leave behind. */
  private advance(now: number): void {
    for (const s of this.states) {
      const curB = this.clock.bucketOf(now, s.ms);
      if (s.formingBucket != null && curB > s.formingBucket) this.tryClose(s, s.formingBucket);
      if (s.formingBucket == null || curB > s.formingBucket) s.formingBucket = curB;
    }
  }

  /** Fold the CLOSED constituents of a bucket and emit onClose — idempotent by
   *  signature, so an unchanged bucket never re-emits but a reconciled one does. */
  private tryClose(s: PeriodState, bStart: number): void {
    const bars = this.constituents(bStart, s.ms, false);
    if (!bars.length) return;
    const bar = this.fold(bars, bStart);
    const key = `${s.period}@${bStart}`;
    const sig = `${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`;
    if (this.closeSig.get(key) === sig) return;
    this.closeSig.set(key, sig);
    for (const cb of this.closeCbs) cb(s.period, bar);
  }

  /** The current forming (provisional) bar for a period, or null if no data yet. */
  private forming(s: PeriodState): Bar | null {
    if (s.formingBucket == null) return null;
    const bars = this.constituents(s.formingBucket, s.ms, true);
    return bars.length ? this.fold(bars, s.formingBucket) : null;
  }

  /** Constituent 1m bars in [bStart, sessionClose). `includeForming` adds the live
   *  1m; when the forming 1m shares a ts with a spine bar, the forming one wins. */
  private constituents(bStart: number, pMs: number, includeForming: boolean): Bar[] {
    const end = this.clock.closeOf(bStart, pMs);
    const fTs = includeForming ? this.forming1m?.ts : undefined;
    const out: Bar[] = [];
    for (const [ts, bar] of this.spine) {
      if (ts >= bStart && ts < end && ts !== fTs) out.push(bar);
    }
    if (includeForming && this.forming1m && this.forming1m.ts >= bStart && this.forming1m.ts < end) {
      out.push(this.forming1m);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  private fold(bars: Bar[], ts: number): Bar {
    let high = -Infinity, low = Infinity, volume = 0;
    for (const b of bars) { high = Math.max(high, b.high); low = Math.min(low, b.low); volume += b.volume; }
    return { ts, open: bars[0].open, high, low, close: bars[bars.length - 1].close, volume };
  }

  private maxSpineTs(): number | null {
    let m: number | null = null;
    for (const ts of this.spine.keys()) if (m == null || ts > m) m = ts;
    return m;
  }

  private prune(): void {
    const newest = Math.max(this.forming1m?.ts ?? 0, this.maxSpineTs() ?? 0);
    if (!newest) return;
    const cutoff = newest - this.keepMs;
    for (const ts of this.spine.keys()) if (ts < cutoff) this.spine.delete(ts);
  }
}
