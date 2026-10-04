import { describe, it, expect, beforeEach } from "vitest";
import { SyncController } from "../SyncController";
import type { ChartController } from "../ChartController";
import type { SyncConfig, Point } from "../types";

// A minimal stand-in for ChartController: an event bus + the command surface
// SyncController drives. Records commands so tests can assert fan-out.
class FakeChart {
  symbolId: string;
  private handlers = new Map<string, Set<Function>>();
  calls: Array<[string, ...unknown[]]> = [];
  private seq = 0;
  constructor(symbol: string) { this.symbolId = symbol; }

  on(type: string, cb: Function): () => void {
    let s = this.handlers.get(type); if (!s) { s = new Set(); this.handlers.set(type, s); }
    s.add(cb); return () => s!.delete(cb);
  }
  emit(type: string, e: unknown): void { for (const cb of this.handlers.get(type) ?? []) (cb as (e: unknown) => void)(e); }

  // commands SyncController calls — record, and (for draws) re-emit like the real controller
  draw(tool: string, points: Point[]): string {
    const id = `${this.symbolId}-d${++this.seq}`;
    this.calls.push(["draw", id, tool, points]);
    this.emit("drawingCreated", { id, tool, points }); // programmatic draw emits synchronously
    return id;
  }
  updateDrawing(id: string, points: Point[]): void { this.calls.push(["update", id, points]); this.emit("drawingModified", { id, tool: "trendline", points }); }
  removeDrawing(id: string): void { this.calls.push(["remove", id]); this.emit("drawingRemoved", { id }); }
  setCrosshair(ts: number, value?: number): void { this.calls.push(["xhair", ts, value]); }
  clearCrosshair(): void { this.calls.push(["xhairClear"]); }
  scrollTo(ts: number): void { this.calls.push(["scroll", ts]); }
  setVisibleRange(from: number, to: number): void { this.calls.push(["range", from, to]); this.emit("visibleRangeChange", { from, to }); }

  count(kind: string): number { return this.calls.filter((c) => c[0] === kind).length; }
}

const ALL_ON: SyncConfig = { crosshair: true, drawings: true, indicators: true, time: true, dateRange: true, symbol: true, interval: true };

function setup(symbols: string[], cfg: SyncConfig = ALL_ON) {
  const sc = new SyncController();
  const charts = symbols.map((s) => new FakeChart(s));
  for (const c of charts) { sc.add(c as unknown as ChartController, "g"); sc.setConfig(c as unknown as ChartController, cfg); }
  return { sc, charts };
}
const pts: Point[] = [{ ts: 1000, value: 10 }, { ts: 2000, value: 20 }];

describe("SyncController — crosshair (symbol-scoped)", () => {
  it("fans crosshair to same-symbol peers only", () => {
    const { charts } = setup(["NIFTY", "NIFTY", "BANKNIFTY"]);
    const [a, b, c] = charts;
    a.emit("crosshairMove", { ts: 5000, value: 42 });
    expect(b.calls).toContainEqual(["xhair", 5000, 42]); // same symbol → synced
    expect(c.count("xhair")).toBe(0);                    // different symbol → not synced
  });
  it("does not fan when the source has crosshair disabled", () => {
    const { sc, charts } = setup(["NIFTY", "NIFTY"]);
    const [a, b] = charts;
    sc.setConfig(a as unknown as ChartController, { ...ALL_ON, crosshair: false });
    a.emit("crosshairMove", { ts: 5000, value: 42 });
    expect(b.count("xhair")).toBe(0);
  });
});

describe("SyncController — time (click → scroll, whole layout)", () => {
  it("scrolls every other chart to the clicked ts regardless of symbol", () => {
    const { charts } = setup(["NIFTY", "NIFTY", "BANKNIFTY"]);
    const [a, b, c] = charts;
    a.emit("click", { ts: 7777, value: 1 });
    expect(b.calls).toContainEqual(["scroll", 7777]);
    expect(c.calls).toContainEqual(["scroll", 7777]); // whole layout, not symbol-scoped
    expect(a.count("scroll")).toBe(0);                 // source doesn't scroll itself
  });
});

describe("SyncController — dateRange (echo-suppressed)", () => {
  it("fans the window to peers without feeding back (no echo loop)", () => {
    const { charts } = setup(["NIFTY", "BANKNIFTY"]);
    const [a, b] = charts;
    a.emit("visibleRangeChange", { from: 100, to: 200 });
    expect(b.calls).toContainEqual(["range", 100, 200]); // B got the window
    expect(a.count("range")).toBe(0);                    // echo from B did NOT bounce back to A
  });
});

describe("SyncController — drawings (symbol-scoped, id-mapped, echo-suppressed)", () => {
  let charts: FakeChart[];
  beforeEach(() => { charts = setup(["NIFTY", "NIFTY", "BANKNIFTY"]).charts; });

  it("replicates a create to same-symbol peers only, with one draw each (no echo storm)", () => {
    const [a, b, c] = charts;
    a.emit("drawingCreated", { id: "a1", tool: "trendline", points: pts });
    expect(b.count("draw")).toBe(1); // replicated once
    expect(c.count("draw")).toBe(0); // different symbol
  });

  it("maps ids so a later modify/remove reaches the peer's own overlay id", () => {
    const [a, b] = charts;
    a.emit("drawingCreated", { id: "a1", tool: "trendline", points: pts });
    const peerId = (b.calls.find((x) => x[0] === "draw")![1]) as string;

    a.emit("drawingModified", { id: "a1", points: [{ ts: 3000, value: 30 }] });
    expect(b.calls).toContainEqual(["update", peerId, [{ ts: 3000, value: 30 }]]);

    a.emit("drawingRemoved", { id: "a1" });
    expect(b.calls).toContainEqual(["remove", peerId]);
  });
});
