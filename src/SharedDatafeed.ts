// SharedDatafeed — dedup + derive-from-base (kb/CHARTMANAGER.md §2/§6.3, D-CM1/D-CM5).
//
// Wraps a host Datafeed so a grid of N charts on the same symbol opens ONE upstream
// subscription, not N. Per symbol it keeps a "1m spine" + a MultiPeriodAggregator and
// fans the derived bars out to every subscribed timeframe.
//
//   • getBars(sym, tf, …)  → passes straight through (per-TF backfill stays authoritative).
//   • subscribe(sym, tf, …) → joins the symbol's hub; the hub runs ONE base 1m
//     subscription, derives every tf via the aggregator, and pushes forming + closed bars.
//
// Charts are unchanged — they still speak the plain Datafeed interface; they don't know
// a hub exists. This is the object ChartManager feeds to every ChartController.

import type { Datafeed } from "./adapters";
import type { Bar, Period, Unsubscribe, SessionSpec } from "./types";
import { MultiPeriodAggregator } from "./aggregation";
import { SessionClock, periodToMs } from "./session";

export interface SharedDatafeedOptions {
  /** Per-instrument trading session (for session-anchored derivation). */
  session?: (symbol: string) => SessionSpec | undefined;
  /** Minimum 1m history to seed the spine with, ms (default 1 day — a full session, so a
   *  forming 1d/4h bar keeps the day's true open/high/low/volume). Raised to the
   *  subscribing period when that is longer. */
  seedMs?: number;
}

type BarCb = (bar: Bar) => void;

interface Hub {
  agg: MultiPeriodAggregator;
  listeners: Map<Period, Set<BarCb>>;
  baseUnsub: Unsubscribe | null;
  started: boolean;
  disposed: boolean;
}

export function createSharedDatafeed(base: Datafeed, opts: SharedDatafeedOptions = {}): Datafeed {
  const seedMs = opts.seedMs ?? 86_400_000;
  const hubs = new Map<string, Hub>();

  function emitTo(hub: Hub, period: Period, bar: Bar): void {
    const set = hub.listeners.get(period);
    if (set) for (const cb of set) cb(bar);
  }

  function getHub(symbol: string): Hub {
    let hub = hubs.get(symbol);
    if (hub) return hub;
    const clock = new SessionClock(opts.session?.(symbol));
    const agg = new MultiPeriodAggregator([], clock);
    hub = { agg, listeners: new Map(), baseUnsub: null, started: false, disposed: false };
    agg.onClose((period, bar) => emitTo(hub!, period, bar)); // confirmed / reconciled closes
    hubs.set(symbol, hub);
    return hub;
  }

  async function ensureStarted(symbol: string, hub: Hub, period: Period): Promise<void> {
    if (hub.started) return;
    hub.started = true;
    // Seed the 1m spine so the first forming higher-TF bar is grounded in real 1m (§2 seam).
    // Bounded (historical/replay) feeds end in the past: seed up to THEIR end, not "now".
    try {
      const to = base.getRange?.(symbol, "1m")?.to ?? Date.now();
      const span = Math.max(seedMs, periodToMs(period));
      const bars = await base.getBars(symbol, "1m", to - span, to);
      if (!hub.disposed) hub.agg.seed1m(bars);
    } catch { /* best-effort seed; live still works from the spine building up */ }
    if (hub.disposed) return;
    // ONE upstream live subscription per symbol, at 1m. Derive every tf from it.
    hub.baseUnsub = base.subscribe(symbol, "1m", (bar) => {
      const forming = hub.agg.pushForming1m(bar);
      for (const [period, b] of forming) emitTo(hub, period, b);
    });
  }

  function teardownHub(symbol: string, hub: Hub): void {
    hub.disposed = true;
    hub.baseUnsub?.();
    hub.baseUnsub = null;
    hubs.delete(symbol);
  }

  return {
    getBars(symbol, period, from, to) {
      return base.getBars(symbol, period, from, to); // per-TF backfill, unchanged
    },
    // bounded (historical) host feeds keep their span through the hub
    ...(base.getRange ? { getRange: (symbol: string, period: Period) => base.getRange!(symbol, period) } : {}),
    subscribe(symbol, period, onBar): Unsubscribe {
      const hub = getHub(symbol);
      if (!hub.agg.hasPeriod(period)) hub.agg.addPeriod(period);
      let set = hub.listeners.get(period);
      if (!set) { set = new Set(); hub.listeners.set(period, set); }
      set.add(onBar);
      void ensureStarted(symbol, hub, period);
      return () => {
        set!.delete(onBar);
        if (set!.size === 0) hub.listeners.delete(period);
        if (hub.listeners.size === 0) teardownHub(symbol, hub);
      };
    },
  };
}
