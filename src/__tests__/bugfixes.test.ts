// Regression tests for kb/bugs.md (BUG-01 … BUG-09).
import { describe, it, expect, vi } from "vitest";

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 6, 3, 45); // Mon 09:15 IST

// --- klinecharts mock (same shape as ChartController.test.ts) -----------------
type Call = { method: string; args: any[] };
let spy: { chart: any; calls: Call[] };
function makeChartSpy() {
  const calls: Call[] = [];
  const log = (method: string) => (...args: any[]) => { calls.push({ method, args }); return undefined; };
  const chart: any = {
    applyNewData: log("applyNewData"), updateData: log("updateData"), clearData: log("clearData"),
    setLoadDataCallback: (cb: any) => { chart.__load = cb; },
    createIndicator: (_t: any, _s: any, p: any) => p?.id ?? "candle_pane", removeIndicator: log("removeIndicator"),
    createOverlay: () => "o1", overrideOverlay: log("overrideOverlay"), removeOverlay: log("removeOverlay"),
    subscribeAction: (type: string, cb: any) => { chart.__actions[type] = cb; },
    setPaneOptions: log("setPaneOptions"), getVisibleRange: () => chart.__range,
    setBarSpace: log("setBarSpace"), scrollToTimestamp: log("scrollToTimestamp"),
    scrollToDataIndex: log("scrollToDataIndex"), scrollByDistance: log("scrollByDistance"),
    getBarSpace: () => 10, resize: () => {}, setStyles: () => {}, setTimezone: () => {},
    getDataList: () => chart.__data,
    __data: [] as any[], __range: { from: 0, to: 0 }, __actions: {} as Record<string, any>, __load: null as any,
  };
  return { chart, calls };
}
vi.mock("klinecharts", () => ({
  init: () => spy.chart,
  dispose: () => {},
  LoadDataType: { Init: "init", Forward: "forward", Backward: "backward" },
  ActionType: { OnCrosshairChange: "c", OnVisibleRangeChange: "v", OnCandleBarClick: "k" },
}));

import { createChart } from "../ChartController";
import { BarBuilder } from "../BarBuilder";
import { TradeLayer } from "../tradeLayer";
import { createSharedDatafeed } from "../SharedDatafeed";
import { MultiPeriodAggregator } from "../aggregation";
import { SessionClock } from "../session";
import type { Datafeed } from "../adapters";
import type { Bar } from "../types";

const flush = () => new Promise((r) => setTimeout(r, 0));
const kbars = (n: number, step = MIN, t0 = T0) =>
  Array.from({ length: n }, (_, i) => ({ timestamp: t0 + i * step, open: 1, high: 2, low: 0, close: 1, volume: 0 }));

function mount(df: Partial<Datafeed>) {
  spy = makeChartSpy();
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 1000 });
  const feed = { getBars: async () => [], subscribe: () => () => {}, ...df } as Datafeed;
  return createChart(el, { datafeed: feed });
}

describe("BUG-01 setVisibleRange / getVisibleRange speak timestamps", () => {
  it("pins `to` at the right edge and spaces by LOADED bars (not wall-clock span)", () => {
    const c = mount({});
    spy.chart.__data = kbars(100);
    c.setVisibleRange(T0 + 50 * MIN, T0 + 99 * MIN);
    const space = spy.calls.find((x) => x.method === "setBarSpace")!.args[0];
    expect(space).toBeCloseTo(1000 / 50);
    expect(spy.calls.find((x) => x.method === "scrollToDataIndex")!.args[0]).toBe(99);
    expect(spy.calls.some((x) => x.method === "scrollToTimestamp" && x.args[0] === T0 + 50 * MIN)).toBe(false);
  });

  it("session gaps don't shrink candles: a weekend-spanning window counts bars", () => {
    const c = mount({});
    // two sessions of 10 bars separated by ~3 days
    spy.chart.__data = [...kbars(10), ...kbars(10, MIN, T0 + 3 * DAY)];
    c.setVisibleRange(T0, T0 + 3 * DAY + 9 * MIN);
    expect(spy.calls.find((x) => x.method === "setBarSpace")!.args[0]).toBeCloseTo(1000 / 20);
  });

  it("translates v9's index range into timestamps (getVisibleRange + event)", () => {
    const c = mount({});
    spy.chart.__data = kbars(100);
    spy.chart.__range = { from: 10, to: 20 }; // v9: [from, to) bar indices
    expect(c.getVisibleRange()).toEqual({ from: T0 + 10 * MIN, to: T0 + 19 * MIN });
    const seen: any[] = [];
    c.on("visibleRangeChange", (e) => seen.push(e));
    spy.chart.__actions.v();
    expect(seen).toEqual([{ from: T0 + 10 * MIN, to: T0 + 19 * MIN }]);
  });
});

describe("BUG-02 lookback window scales with the period", () => {
  async function requestedSpan(period: string): Promise<number> {
    let span = 0;
    const c = mount({ getBars: async (_s, _p, from, to) => { span = to - from; return []; } });
    await c.setPeriod(period as never);
    await c.setSymbol("X");
    return span;
  }
  it("1d asks for ~500 days, 1m keeps 7 days, 1s is capped", async () => {
    expect(await requestedSpan("1d")).toBe(500 * DAY);
    expect(await requestedSpan("1m")).toBe(7 * DAY);
    expect(await requestedSpan("1s")).toBe(20_000 * 1000);
  });
});

describe("BUG-03 live subscription resumes after paging back to the feed end", () => {
  it("re-subscribes once a Backward page reaches range.to", async () => {
    const end = T0 + 10_000 * MIN;
    let subs = 0;
    const c = mount({
      getRange: () => ({ from: T0, to: end }),
      getBars: async (_s, _p, from, to) => {
        const out: Bar[] = [];
        for (let t = Math.ceil(from / MIN) * MIN; t <= Math.min(to, end); t += MIN) out.push({ ts: t, open: 1, high: 1, low: 1, close: 1, volume: 0 });
        return out.slice(0, 50);
      },
      subscribe: () => { subs++; return () => {}; },
    });
    await c.setSymbol("X");
    expect(subs).toBe(1);
    await c.jumpTo(T0 + 100 * MIN); // mid-history: live detached
    expect(subs).toBe(1);
    const cb = vi.fn();
    spy.chart.__load({ type: "backward", data: { timestamp: end - 10 * MIN }, callback: cb });
    await flush();
    expect(cb).toHaveBeenCalledWith(expect.any(Array), false);
    expect(subs).toBe(2);
  });
});

describe("BUG-09 Tier-2 stubs report errors instead of throwing", () => {
  it("plotSeries / movePaneSeries emit on the error channel", () => {
    const c = mount({});
    const errs: any[] = [];
    c.on("error", (e) => errs.push(e));
    expect(() => c.plotSeries("main", [], {} as never)).not.toThrow();
    expect(() => c.movePaneSeries("s", "main")).not.toThrow();
    expect(errs.map((e) => e.op)).toEqual(["plotSeries", "movePaneSeries"]);
    expect(errs[0].retryable).toBe(false);
  });
});

describe("BUG-04 SharedDatafeed seed", () => {
  it("seeds bounded feeds up to their END, covering at least a day", async () => {
    const end = Date.UTC(2024, 5, 3, 10, 0);
    const calls: Array<[number, number]> = [];
    const base: Datafeed = {
      getRange: () => ({ from: 0, to: end }),
      getBars: async (_s, _p, from, to) => { calls.push([from, to]); return []; },
      subscribe: () => () => {},
    };
    createSharedDatafeed(base).subscribe("X", "1d", () => {});
    await flush();
    expect(calls[0]).toEqual([end - DAY, end]);
  });

  it("aggregator keeps a full session after periods are added later", () => {
    const agg = new MultiPeriodAggregator([], new SessionClock());
    agg.addPeriod("1d");
    const day = Date.UTC(2025, 0, 6);
    agg.seed1m(Array.from({ length: 300 }, (_, i) => ({ ts: day + i * MIN, open: i, high: i + 1, low: i, close: i, volume: 1 })));
    const forming = agg.pushForming1m({ ts: day + 300 * MIN, open: 0, high: 0, low: 0, close: 0, volume: 1 });
    const d = forming.get("1d")!;
    expect(d.open).toBe(0);      // the session's first minute survived pruning
    expect(d.volume).toBe(301);
  });
});

describe("BUG-05 BarBuilder session anchoring", () => {
  it("NSE 1h buckets start at 09:15 IST, not 08:30/09:30", () => {
    const b = new BarBuilder("1h", { session: { tz: "Asia/Kolkata", sessions: [{ start: "09:15", end: "15:30" }] } });
    expect(b.push({ ts: T0 + 50 * MIN, price: 1 }).ts).toBe(T0);           // 10:05 → 09:15 bucket
    expect(b.push({ ts: T0 + 65 * MIN, price: 1 }).ts).toBe(T0 + 60 * MIN); // 10:20 → 10:15 bucket
  });
});

describe("BUG-08 forming-bar marker follows the bar's high", () => {
  it("re-anchors when the last bar's high expands", () => {
    let data = kbars(3).map((b, i) => ({ ...b, high: 10 + i }));
    const overlays = new Map<string, any>();
    const chart: any = {
      getDataList: () => data,
      createOverlay: (o: any) => { overlays.set("m", o); return "m"; },
      overrideOverlay: (o: any) => { overlays.set(o.id, { ...overlays.get(o.id), ...o }); },
      removeOverlay: () => {},
    };
    const layer = new TradeLayer(chart, () => MIN);
    layer.setMarkers([{ ts: T0 + 2 * MIN, position: "aboveBar", shape: "arrowDown" } as never]);
    expect(overlays.get("m").points[0].value).toBe(12);
    data = data.map((b, i) => (i === 2 ? { ...b, high: 15 } : b));
    layer.sync();
    expect(overlays.get("m").points[0].value).toBe(15);
  });
});
