import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mock klinecharts: capture the calls ChartController makes so we can assert
// the isStack rule (A1) and main->candle_pane mapping (A2) without a real chart.
type Call = { method: string; args: any[] };

function makeChartSpy() {
  const calls: Call[] = [];
  const log = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    // createIndicator returns the pane id it was asked to use.
    if (method === "createIndicator") {
      const paneOpts = args[2];
      return paneOpts?.id ?? "candle_pane";
    }
    if (method === "createOverlay") return "overlay_1";
    return undefined;
  };
  const chart: any = {
    applyNewData: log("applyNewData"), updateData: log("updateData"),
    clearData: log("clearData"), setLoadDataCallback: log("setLoadDataCallback"),
    createIndicator: log("createIndicator"), removeIndicator: log("removeIndicator"),
    createOverlay: log("createOverlay"), overrideOverlay: log("overrideOverlay"),
    removeOverlay: log("removeOverlay"), getOverlayById: () => null,
    subscribeAction: log("subscribeAction"), unsubscribeAction: () => {},
    setPaneOptions: log("setPaneOptions"), getVisibleRange: () => ({ from: 0, to: 100 }),
    setBarSpace: log("setBarSpace"), scrollToTimestamp: log("scrollToTimestamp"),
    zoomAtTimestamp: log("zoomAtTimestamp"), setTimezone: log("setTimezone"),
    resize: log("resize"), setStyles: log("setStyles"),
    scrollByDistance: log("scrollByDistance"), scrollToDataIndex: log("scrollToDataIndex"), getBarSpace: () => 10,
    getDataList: () => chart.__data ?? [], __data: [] as any[], __initOpts: null as any,
  };
  return { chart, calls };
}

let spy: ReturnType<typeof makeChartSpy>;
vi.mock("klinecharts", () => ({
  init: (_el: unknown, o: unknown) => { spy.chart.__initOpts = o; return spy.chart; },
  dispose: () => {},
  LoadDataType: { Init: "init", Forward: "forward", Backward: "backward" },
  ActionType: {
    OnCrosshairChange: "onCrosshairChange", OnVisibleRangeChange: "onVisibleRangeChange",
    OnCandleBarClick: "onCandleBarClick",
  },
}));

import { createChart } from "../ChartController";

function fresh(): { chart: ReturnType<typeof createChart>; calls: Call[] } {
  spy = makeChartSpy();
  const div = document.createElement("div");
  const chart = createChart(div, { datafeed: { getBars: async () => [], subscribe: () => () => {} } } as never);
  return { chart, calls: spy.calls };
}

describe("ChartController.addIndicator — isStack rule (A1) + main->candle_pane (A2)", () => {
  beforeEach(() => { spy = makeChartSpy(); });

  it("overlays EMA on the main pane with isStack=true and pane id 'candle_pane'", () => {
    const { chart, calls } = fresh();
    chart.addIndicator("EMA", "main", [20, 50]);
    const c = calls.find((x) => x.method === "createIndicator")!;
    expect(c.args[0]).toEqual({ name: "EMA", calcParams: [20, 50] });
    expect(c.args[1]).toBe(true);            // isStack: overlay on candles
    expect(c.args[2]).toEqual({ id: "candle_pane" }); // "main" -> candle_pane
  });

  it("defaults paneId to the candle pane (overlay, stack=true) when omitted", () => {
    const { chart, calls } = fresh();
    chart.addIndicator("BOLL");
    const c = calls.find((x) => x.method === "createIndicator")!;
    expect(c.args[1]).toBe(true);
    expect(c.args[2]).toEqual({ id: "candle_pane" });
  });

  it("puts a sub-pane indicator (VOL) into a created pane with isStack=false", () => {
    const { chart, calls } = fresh();
    const paneId = chart.createPane({ height: 120 });
    chart.addIndicator("VOL", paneId);
    const c = calls.find((x) => x.method === "createIndicator" && x.args[2]?.id === paneId)!;
    expect(c.args[1]).toBe(false);           // standalone pane, no stack
    expect(c.args[2].id).toBe(paneId);
  });
});

describe("ChartController overlay registry (B4) — draw/serialize/restore", () => {
  beforeEach(() => { spy = makeChartSpy(); });

  it("serialize() reflects drawings pushed via draw()", () => {
    const { chart } = fresh();
    chart.draw("trendline", [{ ts: 1, value: 10 }, { ts: 2, value: 20 }]);
    const snap = chart.serialize();
    expect(snap.version).toBe(1);
    expect(snap.drawings).toHaveLength(1);
    expect(snap.drawings[0].tool).toBe("trendline");
    expect(snap.drawings[0].points).toEqual([{ ts: 1, value: 10 }, { ts: 2, value: 20 }]);
  });

  it("clearDrawings empties the serialized layout", () => {
    const { chart } = fresh();
    chart.draw("rect", [{ ts: 1, value: 10 }, { ts: 2, value: 20 }]);
    chart.clearDrawings();
    expect(chart.serialize().drawings).toHaveLength(0);
  });

  it("restore() re-creates drawings via draw()", () => {
    const { chart, calls } = fresh();
    chart.restore({
      version: 1, drawings: [
        { id: "x", tool: "hline", points: [{ ts: 1, value: 99 }] },
      ], panes: [], seriesSpecs: [], viewRange: { from: 0, to: 100 },
    });
    // restore -> clearDrawings (removeOverlay no-arg) + one createOverlay for the hline
    const overlays = calls.filter((x) => x.method === "createOverlay");
    expect(overlays.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ChartController events (A3) — on() wires subscribeAction", () => {
  beforeEach(() => { spy = makeChartSpy(); });

  it("subscribes to OnCrosshairChange only when a crosshairMove handler is added", () => {
    const { chart, calls } = fresh();
    const off = chart.on("crosshairMove", () => {});
    const subs = calls.filter((x) => x.method === "subscribeAction");
    expect(subs).toHaveLength(1);
    expect(subs[0].args[0]).toBe("onCrosshairChange");
    off();
  });

  it("setTimezone forwards to v9 (v1, D-T5)", () => {
    const { chart, calls } = fresh();
    chart.setTimezone("Asia/Kolkata");
    expect(calls.some((x) => x.method === "setTimezone" && x.args[0] === "Asia/Kolkata")).toBe(true);
  });
});

describe("ChartController drawing lifecycle events (Step 2)", () => {
  beforeEach(() => { spy = makeChartSpy(); });

  it("emits drawingCreated immediately for a programmatic draw (points given)", () => {
    const { chart } = fresh();
    let created: any = null;
    chart.on("drawingCreated", (e) => { created = e; });
    chart.draw("hline", [{ ts: 100, value: 50 }]);
    expect(created).toEqual({ id: "overlay_1", tool: "hline", points: [{ ts: 100, value: 50 }] });
  });

  it("onDrawEnd callback converts v9 {timestamp,value} -> TickLine {ts,value} and emits drawingCreated", () => {
    const { chart, calls } = fresh();
    let created: any = null;
    chart.on("drawingCreated", (e) => { created = e; });
    chart.draw("segment"); // interactive (no points) -> no immediate emit
    expect(created).toBeNull();
    // grab the handlers passed to createOverlay and simulate the engine firing onDrawEnd
    const createCall = calls.find((c) => c.method === "createOverlay")!;
    const handlers = createCall.args[0] as { onDrawEnd: (e: any) => boolean };
    handlers.onDrawEnd({ overlay: { id: "overlay_1", points: [{ timestamp: 200, value: 99 }, { timestamp: 300, value: 77 }] } });
    expect(created).toEqual({ id: "overlay_1", tool: "segment", points: [{ ts: 200, value: 99 }, { ts: 300, value: 77 }] });
  });

  it("onPressedMoveEnd emits drawingModified; onRemoved emits drawingRemoved", () => {
    const { chart, calls } = fresh();
    let modified: any = null, removed: any = null;
    chart.on("drawingModified", (e) => { modified = e; });
    chart.on("drawingRemoved", (e) => { removed = e; });
    chart.draw("rect", [{ ts: 1, value: 10 }, { ts: 2, value: 20 }]);
    const handlers = calls.find((c) => c.method === "createOverlay")!.args[0] as any;
    handlers.onPressedMoveEnd({ overlay: { id: "overlay_1", points: [{ timestamp: 1, value: 5 }] } });
    expect(modified.tool).toBe("rect");
    expect(modified.points).toEqual([{ ts: 1, value: 5 }]);
    handlers.onRemoved({ overlay: { id: "overlay_1" } });
    expect(removed).toEqual({ id: "overlay_1" });
  });

  it("restore() re-creates drawings WITHOUT emitting drawingCreated (silent bulk rehydrate)", () => {
    const { chart } = fresh();
    let count = 0;
    chart.on("drawingCreated", () => { count++; });
    chart.restore({
      version: 1, drawings: [{ id: "x", tool: "hline", points: [{ ts: 1, value: 1 }] }],
      panes: [], seriesSpecs: [], viewRange: { from: 0, to: 1 },
    });
    expect(count).toBe(0);
  });

  it("clearDrawings emits drawingRemoved for each known drawing", () => {
    const { chart } = fresh();
    const removed: string[] = [];
    chart.on("drawingRemoved", (e) => { removed.push(e.id); });
    chart.draw("hline", [{ ts: 1, value: 1 }]);
    chart.clearDrawings();
    expect(removed).toContain("overlay_1");
  });
});

describe("ChartController — bounded (historical/replay) feeds", () => {
  const END = Date.UTC(2025, 5, 30, 10, 0);
  const START = END - 60 * 86_400_000;

  function bounded() {
    spy = makeChartSpy();
    const getBars = vi.fn(async (_s: string, _p: string, from: number, to: number) =>
      [{ ts: Math.max(from, START), open: 1, high: 1, low: 1, close: 1, volume: 0 }, { ts: Math.min(to, END), open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
    const subscribe = vi.fn(() => () => {});
    const chart = createChart(document.createElement("div"), {
      datafeed: { getBars, subscribe, getRange: () => ({ from: START, to: END }) },
    } as never);
    return { chart, getBars, subscribe, calls: spy.calls };
  }

  it("opens at the feed's END (not Date.now()) and subscribes", async () => {
    const { chart, getBars, subscribe } = bounded();
    await chart.setSymbol("NIFTY");
    const [, , from, to] = getBars.mock.calls[0];
    expect(to).toBe(END);
    expect(to - from).toBe(7 * 86_400_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("jumpTo() reloads a window centred on ts and does not subscribe mid-history", async () => {
    const { chart, getBars, subscribe, calls } = bounded();
    await chart.setSymbol("NIFTY");
    const ts = START + 20 * 86_400_000;
    await chart.jumpTo(ts);
    const [, , from, to] = getBars.mock.calls[1];
    expect(from).toBe(ts - 3.5 * 86_400_000);
    expect(to).toBe(ts + 3.5 * 86_400_000);
    expect(subscribe).toHaveBeenCalledTimes(1); // only the initial at-end load
    // the spy never stores data, so centring falls back to scrollToTimestamp(ts)
    expect(calls.filter((c) => c.method === "scrollToTimestamp").slice(-1)[0].args[0]).toBe(ts);
  });

  it("pages NEWER bars on Backward for bounded feeds; answers empty for live feeds", async () => {
    const { chart, getBars, calls } = bounded();
    await chart.setSymbol("NIFTY");
    const cb = calls.find((c) => c.method === "setLoadDataCallback")!.args[0];
    const done = vi.fn();
    const after = END - 2 * 86_400_000;
    cb({ type: "backward", data: { timestamp: after }, callback: done });
    await new Promise((r) => setTimeout(r, 0));
    expect(getBars.mock.calls.slice(-1)[0].slice(2)).toEqual([after + 1, after + 7 * 86_400_000]);
    expect(done.mock.calls[0][1]).toBe(false); // reached END -> no more
    // view held in place: scrolled back by the 2 appended bars x barSpace 10
    expect(calls.filter((c) => c.method === "scrollByDistance").slice(-1)[0].args[0]).toBe(20);
    // live feed (no getRange): Backward stays empty
    const live = fresh();
    await live.chart.setSymbol("X");
    const liveCb = live.calls.find((c) => c.method === "setLoadDataCallback")!.args[0];
    const liveDone = vi.fn();
    liveCb({ type: "backward", data: { timestamp: after }, callback: liveDone });
    expect(liveDone).toHaveBeenCalledWith([], false);
  });

  it("theme 'dark' passes TickLine's full palette to init and paints the background", () => {
    spy = makeChartSpy();
    const div = document.createElement("div");
    const chart = createChart(div, { datafeed: { getBars: async () => [], subscribe: () => () => {} }, theme: "dark" } as never);
    expect(spy.chart.__initOpts.styles.candle.bar.upColor).toBe("#26a69a");
    expect(div.style.background).not.toBe("");
    chart.setTheme("light");
    expect(spy.calls.some((c) => c.method === "setStyles")).toBe(true);
  });

  it("setMarkers no longer throws and creates a tlMarker overlay for a loaded bar", () => {
    const { chart, calls } = fresh();
    spy.chart.__data = [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }];
    chart.setMarkers([{ ts: 1000, position: "belowBar", shape: "arrowUp" }]);
    const c = calls.find((x) => x.method === "createOverlay" && x.args[0].name === "tlMarker")!;
    expect(c.args[0].points).toEqual([{ timestamp: 1000, value: 0.5 }]);
  });
});
