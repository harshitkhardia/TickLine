import { describe, it, expect } from "vitest";
import { createSharedDatafeed } from "../SharedDatafeed";
import type { Datafeed } from "../adapters";
import type { Bar } from "../types";

const tick = () => new Promise((r) => setTimeout(r, 0));

// A fake base feed that records how many live subscriptions it opens and lets the
// test push 1m bars into the captured onBar.
function fakeBase() {
  const state = { baseSubs: 0, pushers: [] as Array<(b: Bar) => void>, getBarsCalls: [] as string[] };
  const base: Datafeed = {
    async getBars(symbol, period) { state.getBarsCalls.push(`${symbol}/${period}`); return []; },
    subscribe(_symbol, _period, onBar) { state.baseSubs++; state.pushers.push(onBar); return () => {}; },
  };
  return { base, state };
}

describe("SharedDatafeed — dedup + derive", () => {
  it("opens ONE upstream subscription for two timeframes of the same symbol", async () => {
    const { base, state } = fakeBase();
    const shared = createSharedDatafeed(base);
    const got1m: Bar[] = [];
    const got5m: Bar[] = [];
    shared.subscribe("NIFTY", "1m", (b) => got1m.push(b));
    shared.subscribe("NIFTY", "5m", (b) => got5m.push(b));
    await tick(); // let ensureStarted's awaited seed resolve, then base.subscribe fires

    expect(state.baseSubs).toBe(1); // dedup: one socket for both charts

    // push a live 1m bar → both the 1m and derived 5m listeners get a forming bar
    state.pushers[0]({ ts: 60_000, open: 100, high: 101, low: 99, close: 100, volume: 5 });
    expect(got1m.length).toBeGreaterThan(0);
    expect(got5m.length).toBeGreaterThan(0);
    expect(got1m[got1m.length - 1].ts).toBe(60_000);        // 1m bucket
    expect(got5m[got5m.length - 1].ts).toBe(0);             // 5m bucket [0,300000)
  });

  it("subscribes to the base at 1m (derive-from-base), and backfills per-TF", async () => {
    const { base, state } = fakeBase();
    const shared = createSharedDatafeed(base);
    await shared.getBars("NIFTY", "15m", 0, 1);   // per-TF backfill passes through
    shared.subscribe("NIFTY", "15m", () => {});
    await tick();
    expect(state.getBarsCalls).toContain("NIFTY/15m"); // the chart's own TF backfill
    expect(state.getBarsCalls).toContain("NIFTY/1m");  // the spine seed
  });

  it("tears down the upstream sub when the last listener unsubscribes", async () => {
    const { base, state } = fakeBase();
    let unsubbed = false;
    base.subscribe = (_s, _p, _cb) => { state.baseSubs++; return () => { unsubbed = true; }; };
    const shared = createSharedDatafeed(base);
    const off = shared.subscribe("NIFTY", "1m", () => {});
    await tick();
    off();
    expect(unsubbed).toBe(true);
  });
});

describe("SharedDatafeed — bounded host feeds", () => {
  it("passes getRange through (and omits it for live feeds)", () => {
    const range = { from: 1, to: 2 };
    const bounded = createSharedDatafeed({ getBars: async () => [], subscribe: () => () => {}, getRange: () => range });
    expect(bounded.getRange?.("NIFTY", "1m")).toEqual(range);
    const live = createSharedDatafeed({ getBars: async () => [], subscribe: () => () => {} });
    expect(live.getRange).toBeUndefined();
  });
});
