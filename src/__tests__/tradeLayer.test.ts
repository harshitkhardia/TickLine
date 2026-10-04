import { describe, it, expect } from "vitest";
import { TradeLayer, barIndexAtOrBefore } from "../tradeLayer";

const MIN = 60_000;
const T0 = Date.UTC(2025, 0, 6, 3, 45); // 09:15 IST

// Fake v9 chart: a mutable data list + an overlay table.
function fakeChart() {
  let data: any[] = [];
  let n = 0;
  const overlays = new Map<string, any>();
  const chart: any = {
    getDataList: () => data,
    createOverlay: (o: any) => { const id = `o${++n}`; overlays.set(id, { ...o }); return id; },
    overrideOverlay: (o: any) => { overlays.set(o.id, { ...overlays.get(o.id), ...o }); },
    removeOverlay: (arg?: any) => {
      if (arg == null) overlays.clear();
      else if (typeof arg === "string") overlays.delete(arg);
      else if (arg.groupId) for (const [k, v] of overlays) if (v.groupId === arg.groupId) overlays.delete(k);
    },
    getPriceVolumePrecision: () => ({ price: 2, volume: 0 }),
  };
  const bars = (count: number) => Array.from({ length: count }, (_, i) => ({
    timestamp: T0 + i * MIN, open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i, volume: 0,
  }));
  return { chart, overlays, setBars: (count: number) => { data = bars(count); }, byName: (name: string) => [...overlays.values()].filter((o) => o.name === name) };
}

describe("barIndexAtOrBefore", () => {
  const list: any[] = [{ timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }];
  it("finds the containing bar", () => {
    expect(barIndexAtOrBefore(list, 5)).toBe(-1);
    expect(barIndexAtOrBefore(list, 20)).toBe(1);
    expect(barIndexAtOrBefore(list, 29)).toBe(1);
    expect(barIndexAtOrBefore(list, 99)).toBe(2);
  });
});

describe("TradeLayer", () => {
  it("shows a marker only once its bar is loaded, anchored at the bar low for belowBar", () => {
    const f = fakeChart();
    const layer = new TradeLayer(f.chart, () => MIN);
    f.setBars(5);
    layer.setMarkers([{ ts: T0 + 3 * MIN, position: "belowBar", shape: "arrowUp", text: "B" }, { ts: T0 + 8 * MIN, position: "aboveBar", shape: "arrowDown" }]);
    const shown = f.byName("tlMarker");
    expect(shown).toHaveLength(1);
    expect(shown[0].points).toEqual([{ timestamp: T0 + 3 * MIN, value: 101 }]); // bar 3 low = 98+3
    expect(shown[0].lock).toBe(true);
    f.setBars(10); layer.sync();
    const both = f.byName("tlMarker");
    expect(both).toHaveLength(2);
    expect(both[1].points[0].value).toBe(110); // bar 8 high = 102+8
    expect(both[1].extendData.color).toBe("#ef5350"); // arrowDown defaults to sell colour
  });

  it("removes markers whose bar is no longer loaded (replay seek back)", () => {
    const f = fakeChart();
    const layer = new TradeLayer(f.chart, () => MIN);
    f.setBars(10);
    layer.setMarkers([{ ts: T0 + 8 * MIN, position: "inBar", shape: "circle", price: 105 }]);
    expect(f.byName("tlMarker")[0].points[0].value).toBe(105); // explicit price wins
    f.setBars(5); layer.sync();
    expect(f.byName("tlMarker")).toHaveLength(0);
  });

  it("walks a position through hidden -> open (box grows) -> closed (exit point)", () => {
    const f = fakeChart();
    const layer = new TradeLayer(f.chart, () => MIN);
    const pos = { side: "long" as const, entryTs: T0 + 2 * MIN, entryPrice: 100, stopPrice: 95, targetPrice: 110, exitTs: T0 + 6 * MIN, exitPrice: 110 };
    f.setBars(2); layer.setPositions([pos]);
    expect(f.byName("tlPosition")).toHaveLength(0); // entry bar not revealed yet

    f.setBars(4); layer.sync();
    let p = f.byName("tlPosition")[0];
    expect(p.extendData.closed).toBe(false);
    expect(p.points).toHaveLength(3);
    expect(p.points[1]).toEqual({ timestamp: T0 + 3 * MIN, value: 110 }); // box ends at newest bar

    f.setBars(5); layer.sync();
    p = f.byName("tlPosition")[0];
    expect(p.points[1].timestamp).toBe(T0 + 4 * MIN); // grew by one bar (override, same overlay)
    expect(f.byName("tlPosition")).toHaveLength(1);

    f.setBars(8); layer.sync();
    p = f.byName("tlPosition")[0];
    expect(p.extendData.closed).toBe(true);
    expect(p.extendData.exit).toBe(110);
    expect(p.points[3]).toEqual({ timestamp: T0 + 6 * MIN, value: 110 });
  });

  it("shows levels overlapping the loaded range, and survives invalidate()", () => {
    const f = fakeChart();
    const layer = new TradeLayer(f.chart, () => MIN);
    f.setBars(10);
    layer.setLevels([
      { fromTs: T0, toTs: T0 + 9 * MIN, price: 120, label: "PDH" },
      { fromTs: T0 + 60 * MIN, toTs: T0 + 90 * MIN, price: 90, label: "later" },
    ]);
    expect(f.byName("tlLevel")).toHaveLength(1);
    f.chart.removeOverlay(); // engine-wide wipe (clearDrawings)
    layer.invalidate();
    expect(f.byName("tlLevel")).toHaveLength(1);
  });

  it("clear() removes every trade overlay but leaves others alone", () => {
    const f = fakeChart();
    const layer = new TradeLayer(f.chart, () => MIN);
    f.setBars(10);
    f.chart.createOverlay({ name: "segment" });
    layer.setMarkers([{ ts: T0, position: "belowBar", shape: "arrowUp" }]);
    layer.setLevels([{ fromTs: T0, toTs: T0 + 5 * MIN, price: 1 }]);
    layer.clear();
    expect([...f.overlays.values()].map((o) => o.name)).toEqual(["segment"]);
    expect(layer.counts).toEqual({ markers: 0, positions: 0, levels: 0 });
  });
});
