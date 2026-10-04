import { describe, it, expect } from "vitest";
import { BarBuilder } from "../BarBuilder";

describe("BarBuilder", () => {
  it("opens a new bar on the first tick and returns it as the current bar", () => {
    const b = new BarBuilder("5m");
    const bar = b.push({ ts: 1_000_000, price: 100, volume: 5 });
    // ts floors to the 5m bucket: floor(1_000_000 / 300_000) * 300_000 = 900_000
    expect(bar).toEqual({ ts: 900_000, open: 100, high: 100, low: 100, close: 100, volume: 5 });
    expect(b.peek()).toBe(bar);
  });

  it("aggregates ticks within the same bucket (OHLCV)", () => {
    const b = new BarBuilder("5m"); // 300_000 ms
    const bucket = Math.floor(1_000_000 / 300_000) * 300_000;
    b.push({ ts: bucket + 10, price: 100, volume: 1 });
    b.push({ ts: bucket + 20, price: 108, volume: 2 });
    const bar = b.push({ ts: bucket + 30, price: 104, volume: 3 });
    expect(bar.ts).toBe(bucket);
    expect(bar.open).toBe(100);
    expect(bar.high).toBe(108);
    expect(bar.low).toBe(100);
    expect(bar.close).toBe(104);
    expect(bar.volume).toBe(6);
  });

  it("rolls a new bar when the period boundary is crossed", () => {
    const b = new BarBuilder("1m"); // 60_000 ms
    const bar1 = b.push({ ts: 120_000 + 5, price: 50, volume: 1 }); // bucket 120_000
    const bar2 = b.push({ ts: 180_000 + 5, price: 60, volume: 1 }); // bucket 180_000 -> new bar
    expect(bar1.ts).toBe(120_000);
    expect(bar2.ts).toBe(180_000);
    expect(bar2.open).toBe(60);
    expect(b.peek()).toBe(bar2);
  });

  it("accepts arbitrary integer periods (D-CM3): 2m rolls every 120s", () => {
    const b = new BarBuilder("2m"); // 120_000 ms — was 'unsupported' before D-CM3
    const bar1 = b.push({ ts: 120_000 + 5, price: 50, volume: 1 }); // bucket 120_000
    const bar2 = b.push({ ts: 240_000 + 5, price: 60, volume: 1 }); // bucket 240_000 -> new bar
    expect(bar1.ts).toBe(120_000);
    expect(bar2.ts).toBe(240_000);
  });

  it("throws on a malformed period string", () => {
    expect(() => new BarBuilder("5x" as never)).toThrow(/unsupported period/);
    expect(() => new BarBuilder("abc" as never)).toThrow(/unsupported period/);
    expect(() => new BarBuilder("0m" as never)).toThrow(/unsupported period/);
  });

  it("treats missing volume as zero", () => {
    const b = new BarBuilder("5m");
    const bar = b.push({ ts: 1_000_000, price: 100 });
    expect(bar.volume).toBe(0);
  });
});
