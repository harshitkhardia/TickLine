import { describe, it, expect } from "vitest";
import { periodToMs, SessionClock } from "../session";
import type { SessionSpec } from "../types";

// NSE: 09:15–15:30 IST, Mon–Fri. IST = UTC+5:30, no DST.
const NSE: SessionSpec = { tz: "Asia/Kolkata", sessions: [{ start: "09:15", end: "15:30" }] };
// 2026-07-06 is a Monday. IST(h,mi) -> the UTC epoch for that wall-clock time on that date.
const IST = (h: number, mi: number) => Date.UTC(2026, 6, 6, h - 5, mi - 30);
const MIN = 60_000;

describe("periodToMs", () => {
  it("parses the standard set", () => {
    expect(periodToMs("1m")).toBe(60_000);
    expect(periodToMs("5m")).toBe(300_000);
    expect(periodToMs("1h")).toBe(3_600_000);
    expect(periodToMs("1d")).toBe(86_400_000);
    expect(periodToMs("1w")).toBe(604_800_000);
  });
  it("parses ARBITRARY integer periods (the D-CM3 point)", () => {
    expect(periodToMs("10m")).toBe(600_000);
    expect(periodToMs("17m")).toBe(1_020_000);
    expect(periodToMs("2h")).toBe(7_200_000);
    expect(periodToMs("90m")).toBe(5_400_000);
  });
  it("rejects malformed / non-positive periods", () => {
    for (const bad of ["5x", "abc", "m5", "0m", "-3m", "", "5"])
      expect(() => periodToMs(bad)).toThrow(/unsupported period/);
  });
});

describe("SessionClock — no spec (24h UTC floor, matches old BarBuilder)", () => {
  const c = new SessionClock();
  it("floors to the UTC period grid", () => {
    expect(c.bucketOf(1_000_000, 300_000)).toBe(900_000);
    expect(c.closeOf(900_000, 300_000)).toBe(1_200_000);
    expect(c.isOpen(0)).toBe(true);
  });
});

describe("SessionClock — NSE session-anchored (D-CM3)", () => {
  const c = new SessionClock(NSE);

  it("5m aligns cleanly to the 09:15 open", () => {
    expect(c.bucketOf(IST(9, 15), 5 * MIN)).toBe(IST(9, 15));
    expect(c.bucketOf(IST(9, 23), 5 * MIN)).toBe(IST(9, 20));
  });

  it("10m anchors to 09:15 (a UTC grid would straddle the open)", () => {
    // buckets: 09:15, 09:25, 09:35 …  — NOT 09:10/09:20
    expect(c.bucketOf(IST(9, 15), 10 * MIN)).toBe(IST(9, 15));
    expect(c.bucketOf(IST(9, 23), 10 * MIN)).toBe(IST(9, 15));
    expect(c.bucketOf(IST(9, 27), 10 * MIN)).toBe(IST(9, 25));
  });

  it("17m anchors to 09:15 → 09:15, 09:32, 09:49 …", () => {
    expect(c.bucketOf(IST(9, 15), 17 * MIN)).toBe(IST(9, 15));
    expect(c.bucketOf(IST(9, 31), 17 * MIN)).toBe(IST(9, 15));
    expect(c.bucketOf(IST(9, 33), 17 * MIN)).toBe(IST(9, 32));
    expect(c.bucketOf(IST(9, 50), 17 * MIN)).toBe(IST(9, 49));
  });

  it("truncates the last bucket at the session close (15:30)", () => {
    // 17m: last full bucket starts at 09:15 + 22*17m = 15:29; closes at 15:30, not 15:46.
    const last = c.bucketOf(IST(15, 29), 17 * MIN);
    expect(last).toBe(IST(15, 29));
    expect(c.closeOf(last, 17 * MIN)).toBe(IST(15, 30));
    // a mid-session bucket is NOT truncated
    expect(c.closeOf(IST(9, 15), 17 * MIN)).toBe(IST(9, 32));
  });

  it("isOpen respects session hours and trading days", () => {
    expect(c.isOpen(IST(8, 0))).toBe(false);  // before open
    expect(c.isOpen(IST(16, 0))).toBe(false); // after close
    const weekday = new Date(Date.UTC(2026, 6, 6)).getUTCDay(); // Monday
    expect(c.isOpen(IST(10, 0))).toBe(weekday >= 1 && weekday <= 5);
    // Sunday 2026-07-05 at 10:00 IST -> closed regardless of hours
    const sun10 = Date.UTC(2026, 6, 5, 10 - 5, 0 - 30);
    expect(c.isOpen(sun10)).toBe(false);
  });
});
