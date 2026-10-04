import { describe, it, expect } from "vitest";
import { MultiPeriodAggregator } from "../aggregation";
import { SessionClock } from "../session";
import type { Bar, Period } from "../types";

type CloseEvt = { period: Period; bar: Bar };
function collect(agg: MultiPeriodAggregator): CloseEvt[] {
  const evts: CloseEvt[] = [];
  agg.onClose((period, bar) => evts.push({ period, bar }));
  return evts;
}
const MIN = 60_000;
// one tick per minute at `price`, mid-minute, volume `v`
const tickAt = (minute: number, price: number, v = 1) => ({ ts: minute * MIN + 10_000, price, volume: v });

describe("MultiPeriodAggregator — 5m derived from ticks (UTC, no session)", () => {
  it("folds a confirmed 5m bar with correct OHLCV when the bucket closes", () => {
    const agg = new MultiPeriodAggregator(["1m", "5m"]);
    const evts = collect(agg);

    // minute 0 has two ticks; minutes 1..4 one each; minute 5 rolls the 5m bucket.
    agg.pushTick({ ts: 10_000, price: 100, volume: 1 });
    agg.pushTick({ ts: 50_000, price: 105, volume: 1 }); // still minute 0
    agg.pushTick(tickAt(1, 102));
    agg.pushTick(tickAt(2, 108));
    agg.pushTick(tickAt(3, 101));
    const formingAt4 = agg.pushTick(tickAt(4, 104));

    // forming 5m (bucket [0,300000)) reflects the partial fold so far
    const f5 = formingAt4.get("5m")!;
    expect(f5).toMatchObject({ ts: 0, open: 100, high: 108, low: 100, close: 104 });

    // no 5m close yet
    expect(evts.filter((e) => e.period === "5m")).toHaveLength(0);

    // minute 5 tick rolls into the next 5m bucket → bucket 0 closes (confirmed)
    agg.pushTick(tickAt(5, 106));
    const closed5 = evts.filter((e) => e.period === "5m");
    expect(closed5).toHaveLength(1);
    expect(closed5[0].bar).toEqual({ ts: 0, open: 100, high: 108, low: 100, close: 104, volume: 6 });
  });

  it("emits a 1m confirmed close for each rolled minute", () => {
    const agg = new MultiPeriodAggregator(["1m"]);
    const evts = collect(agg);
    agg.pushTick(tickAt(0, 100));
    agg.pushTick(tickAt(1, 101)); // rolling into minute 1 closes minute 0
    const closed1 = evts.filter((e) => e.period === "1m");
    expect(closed1).toHaveLength(1);
    expect(closed1[0].bar.ts).toBe(0);
    expect(closed1[0].bar.close).toBe(100);
  });
});

describe("MultiPeriodAggregator — reconcile from authoritative 1m (D-CM2)", () => {
  it("re-emits the 5m close with corrected volume when a 1m bar is restated", () => {
    const agg = new MultiPeriodAggregator(["5m"]);
    const evts = collect(agg);

    for (let m = 0; m <= 4; m++) agg.pushTick(tickAt(m, 100 + m, 1));
    agg.pushTick(tickAt(5, 106, 1)); // closes 5m bucket 0 from ticks (volume = 5)

    const firstClose = evts.filter((e) => e.period === "5m");
    expect(firstClose).toHaveLength(1);
    expect(firstClose[0].bar.volume).toBe(5);

    // authoritative 1m for minute 2 says volume was really 50, not 1
    agg.push1mClose({ ts: 2 * MIN, open: 102, high: 102, low: 102, close: 102, volume: 50 });

    const allClose = evts.filter((e) => e.period === "5m");
    expect(allClose).toHaveLength(2); // reconciled re-emit
    expect(allClose[1].bar.volume).toBe(54); // 5 - 1 + 50
  });

  it("does NOT re-emit when the restated 1m is identical (signature dedup)", () => {
    const agg = new MultiPeriodAggregator(["5m"]);
    const evts = collect(agg);
    for (let m = 0; m <= 4; m++) agg.pushTick(tickAt(m, 100, 1));
    agg.pushTick(tickAt(5, 100, 1)); // close bucket 0
    const before = evts.length;
    // identical restatement of minute 2 (same OHLCV the tick fold produced)
    agg.push1mClose({ ts: 2 * MIN, open: 100, high: 100, low: 100, close: 100, volume: 1 });
    expect(evts.length).toBe(before);
  });
});

describe("MultiPeriodAggregator — session-anchored (NSE 15m)", () => {
  const NSE = new SessionClock({ tz: "Asia/Kolkata", sessions: [{ start: "09:15", end: "15:30" }] });
  // 2026-07-06 Monday; IST(h,mi) → UTC epoch
  const IST = (h: number, mi: number) => Date.UTC(2026, 6, 6, h - 5, mi - 30);
  const istTick = (h: number, mi: number, price: number, v = 1) => ({ ts: IST(h, mi) + 10_000, price, volume: v });

  it("anchors the 15m bucket to 09:15 and closes it at 09:30", () => {
    const agg = new MultiPeriodAggregator(["15m"], NSE);
    const evts = collect(agg);

    // ticks across 09:15..09:29
    for (let mi = 15; mi <= 29; mi++) agg.pushTick(istTick(9, mi, 200 + mi));
    const forming = agg.pushTick(istTick(9, 29, 250)).get("15m")!;
    expect(forming.ts).toBe(IST(9, 15)); // anchored to the open, not a UTC 09:30 grid

    expect(evts).toHaveLength(0); // not closed yet

    agg.pushTick(istTick(9, 30, 260)); // first tick of the next 15m bucket → close [09:15,09:30)
    expect(evts).toHaveLength(1);
    expect(evts[0].bar.ts).toBe(IST(9, 15));
  });
});

describe("MultiPeriodAggregator — pushForming1m (base delivers whole 1m bars)", () => {
  it("derives a 5m bar from 1m bars, preserving 1m OHLC", () => {
    const agg = new MultiPeriodAggregator(["1m", "5m"]);
    const evts = collect(agg);
    const bar1m = (m: number, o: number, h: number, l: number, c: number, v: number): Bar =>
      ({ ts: m * MIN, open: o, high: h, low: l, close: c, volume: v });

    agg.pushForming1m(bar1m(0, 100, 110, 95, 105, 10));
    agg.pushForming1m(bar1m(1, 105, 106, 100, 102, 10));
    agg.pushForming1m(bar1m(2, 102, 120, 101, 118, 10)); // high 120 comes from a 1m OHLC, not a tick
    agg.pushForming1m(bar1m(3, 118, 119, 90, 92, 10));   // low 90 likewise
    const forming = agg.pushForming1m(bar1m(4, 92, 93, 91, 93, 10)).get("5m")!;
    expect(forming).toMatchObject({ ts: 0, open: 100, high: 120, low: 90, close: 93 });

    agg.pushForming1m(bar1m(5, 93, 93, 93, 93, 10)); // rolls into next 5m → close bucket 0
    const closed = evts.filter((e) => e.period === "5m");
    expect(closed).toHaveLength(1);
    expect(closed[0].bar).toEqual({ ts: 0, open: 100, high: 120, low: 90, close: 93, volume: 50 });
  });

  it("addPeriod lets a new timeframe join after construction", () => {
    const agg = new MultiPeriodAggregator(["1m"]);
    expect(agg.hasPeriod("5m")).toBe(false);
    agg.addPeriod("5m");
    expect(agg.hasPeriod("5m")).toBe(true);
    const out = agg.pushForming1m({ ts: 60_000, open: 1, high: 2, low: 1, close: 2, volume: 1 });
    expect(out.has("5m")).toBe(true);
  });
});
