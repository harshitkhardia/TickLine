import { describe, it, expect, vi, afterEach } from "vitest";
import { StaticDatafeed, sliceRange, barsFromColumns } from "../StaticDatafeed";
import { ReplayDatafeed, attachReplay } from "../ReplayDatafeed";
import type { Bar } from "../types";

const MIN = 60_000;
const T0 = Date.UTC(2025, 0, 6, 3, 45);
const mk = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ ts: T0 + i * MIN, open: i, high: i, low: i, close: i, volume: 0 }));

describe("StaticDatafeed", () => {
  it("slices inclusively by binary search", () => {
    const bars = mk(10);
    expect(sliceRange(bars, T0 + 2 * MIN, T0 + 4 * MIN).map((b) => b.close)).toEqual([2, 3, 4]);
    expect(sliceRange(bars, T0 + 2 * MIN + 1, T0 + 4 * MIN - 1).map((b) => b.close)).toEqual([3]);
    expect(sliceRange(bars, T0 + 50 * MIN, T0 + 60 * MIN)).toEqual([]);
  });

  it("sorts, dedups by ts (last wins) and reports its range", async () => {
    const f = new StaticDatafeed().set("NIFTY", "1m", [mk(3)[2], mk(3)[0], { ...mk(3)[0], close: 99 }, mk(3)[1]]);
    expect(f.get("NIFTY", "1m").map((b) => b.close)).toEqual([99, 1, 2]);
    expect(f.getRange("NIFTY", "1m")).toEqual({ from: T0, to: T0 + 2 * MIN });
    expect(f.getRange("NIFTY", "5m")).toBeNull();
    expect(await f.getBars("NIFTY", "1m", T0 + MIN, T0 + 9 * MIN)).toHaveLength(2);
  });

  it("accepts columnar input (numpy/pandas shape)", () => {
    const bars = barsFromColumns({ ts: [1, 2], open: [10, 11], high: [12, 13], low: [9, 10], close: [11, 12] });
    expect(bars).toEqual([
      { ts: 1, open: 10, high: 12, low: 9, close: 11, volume: 0 },
      { ts: 2, open: 11, high: 13, low: 10, close: 12, volume: 0 },
    ]);
  });
});

describe("ReplayDatafeed", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("hides bars after the cursor from getBars/getRange", async () => {
    const r = new ReplayDatafeed(mk(10), { start: 4 });
    expect((await r.getBars("x", "1m", 0, Infinity)).map((b) => b.close)).toEqual([0, 1, 2, 3, 4]);
    expect(r.getRange()).toEqual({ from: T0, to: T0 + 4 * MIN });
  });

  it("step() pushes newly revealed bars to subscribers in order", () => {
    const r = new ReplayDatafeed(mk(10), { start: 2 });
    const got: number[] = [];
    r.subscribe("x", "1m", (b) => got.push(b.close));
    r.step(3);
    expect(got).toEqual([3, 4, 5]);
    expect(r.state.index).toBe(5);
  });

  it("play() reveals `speed` bars per second and auto-pauses at the end", () => {
    vi.useFakeTimers();
    const r = new ReplayDatafeed(mk(30), { start: 0, speed: 20 });
    const got: number[] = [];
    r.subscribe("x", "1m", (b) => got.push(b.close));
    r.play();
    expect(r.state.playing).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(got).toHaveLength(20);
    vi.advanceTimersByTime(5000);
    expect(r.state.index).toBe(29);
    expect(r.state.playing).toBe(false);
  });

  it("seek() accepts an index or a timestamp and notifies attached charts", () => {
    const r = new ReplayDatafeed(mk(10), { start: 0 });
    const chart = { refresh: vi.fn(async () => {}) };
    attachReplay(chart, r);
    r.seek(T0 + 7 * MIN);
    expect(r.state.index).toBe(7);
    r.seek(2);
    expect(r.state.index).toBe(2);
    expect(chart.refresh).toHaveBeenCalledTimes(2);
  });
});
