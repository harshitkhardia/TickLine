import { describe, it, expect, vi } from "vitest";

// Capture registerOverlay calls to prove the custom `rect` overlay is registered.
const registered: any[] = [];
vi.mock("klinecharts", () => ({
  registerOverlay: (t: any) => registered.push(t),
  getSupportedOverlays: () => [], // pretend nothing is registered yet
}));

import { registerBuiltinOverlays } from "../overlays";

describe("custom overlay registration (rect)", () => {
  it("registers a 2-point `rect` overlay using the v9 rect figure", () => {
    registerBuiltinOverlays();
    const rect = registered.find((t) => t.name === "rect");
    expect(rect).toBeDefined();
    expect(rect.totalStep).toBe(3);
    // createPointFigures draws a bounding box from 2 coordinates
    const figs = rect.createPointFigures({ coordinates: [{ x: 10, y: 20 }, { x: 30, y: 5 }] });
    expect(figs[0].type).toBe("rect");
    expect(figs[0].attrs).toEqual({ x: 10, y: 5, width: 20, height: 15 });
  });

  it("is idempotent (does not register twice)", () => {
    const before = registered.length;
    registerBuiltinOverlays();
    expect(registered.length).toBe(before);
  });
});

import { markerFigures, positionFigures, tradeResult } from "../overlays";

describe("trade annotation overlays", () => {
  it("registers tlMarker / tlPosition / tlLevel as locked-style annotations (no point handles)", () => {
    for (const name of ["tlMarker", "tlPosition", "tlLevel"]) {
      const t = registered.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t.needDefaultPointFigure).toBe(false);
    }
  });

  it("draws a belowBar arrowUp under the anchor, tip pointing up, text beneath", () => {
    const figs = markerFigures({ x: 100, y: 50 }, { position: "belowBar", shape: "arrowUp", color: "#0f0", text: "BUY" });
    const tri = figs[0].attrs as { coordinates: { x: number; y: number }[] };
    expect(figs[0].type).toBe("polygon");
    expect(Math.min(...tri.coordinates.map((c) => c.y))).toBeGreaterThan(50); // entirely below the bar low
    expect(tri.coordinates[0]).toEqual({ x: 100, y: 56 });                    // tip is the top vertex
    expect(figs[1].type).toBe("text");
    expect((figs[1].attrs as { text: string }).text).toBe("BUY");
  });

  it("computes R for long and short closed trades", () => {
    expect(tradeResult({ side: "long", entry: 100, stop: 95, exit: 110 })).toEqual({ pnl: 10, r: 2 });
    expect(tradeResult({ side: "short", entry: 100, stop: 104, exit: 102 })).toEqual({ pnl: -2, r: -0.5 });
    expect(tradeResult({ side: "long", entry: 100, exit: 101 })).toEqual({ pnl: 1, r: null });
  });

  it("position box: profit + loss zones, and a result chip when closed", () => {
    const ext = { side: "long" as const, entry: 100, stop: 95, target: 110, exit: 110, closed: true, precision: 2 };
    const figs = positionFigures([{ x: 10, y: 100 }, { x: 60, y: 50 }, { x: 60, y: 125 }, { x: 60, y: 50 }], ext);
    const rects = figs.filter((f) => f.type === "rect").map((f) => f.attrs);
    expect(rects).toEqual([{ x: 10, y: 50, width: 50, height: 50 }, { x: 10, y: 100, width: 50, height: 25 }]);
    const texts = figs.filter((f) => f.type === "text").map((f) => (f.attrs as { text: string }).text);
    expect(texts).toContain("+2.00R (+10.00)");
    expect(texts.some((t) => t.startsWith("TP 110.00"))).toBe(true);
    // open trade: no result chip
    const open = positionFigures([{ x: 10, y: 100 }, { x: 60, y: 50 }, { x: 60, y: 125 }], { ...ext, closed: false, exit: undefined });
    expect(open.some((f) => f.type === "circle")).toBe(false);
  });
});
