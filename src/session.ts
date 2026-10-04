// SessionClock — session-anchored bar bucketing (kb/CHARTMANAGER.md §4, D-CM3).
//
// Two jobs:
//  1. periodToMs — parse ARBITRARY integer periods ("1m","3m","10m","17m","2h",…),
//     not just a fixed set. This is what lets custom TFs exist at all.
//  2. SessionClock — bucket a timestamp to a period boundary anchored at the
//     SESSION OPEN (e.g. NSE 09:15), not UTC midnight. A UTC-floored 10m/15m/17m
//     bucket straddles the 09:15 open and is wrong; anchoring fixes it.
//
// No spec  → 24h-continuous UTC floor (matches the old BarBuilder, D-T5).
// Time-zone math uses Intl only (no deps): a two-step, DST-safe wall<->UTC pair.

import type { SessionSpec } from "./types";

const MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Parse "<int><s|m|h|d|w>" → milliseconds. Throws on anything else. */
export function periodToMs(period: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(period.trim());
  if (!match) throw new Error(`TickLine: unsupported period "${period}"`);
  const n = parseInt(match[1], 10);
  if (n <= 0) throw new Error(`TickLine: unsupported period "${period}"`);
  return n * MS[match[2] as keyof typeof MS];
}

const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri (0=Sun … 6=Sat)

// ---- Intl helpers (cached formatter per tz) --------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

interface Ymdhms { y: number; mo: number; d: number; h: number; mi: number; s: number; }

/** Wall-clock calendar/time of a UTC instant, as seen in `tz`. */
function partsInTz(utcMs: number, tz: string): Ymdhms {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const g: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") g[p.type] = Number(p.value);
  return { y: g.year, mo: g.month, d: g.day, h: g.hour, mi: g.minute, s: g.second };
}

/** Offset (localWall − UTC) in ms for the instant `utcMs` in `tz`. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(utcMs, tz);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUTC - utcMs;
}

/** Convert a wall-clock time in `tz` (given as calendar components) to a UTC epoch.
 *  Two-step so DST transitions resolve correctly; India has no DST but this stays general. */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi); // treat wall as if it were UTC
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2; // one correction across a DST edge
  return utc;
}

function parseHm(hm: string): { h: number; mi: number } {
  const [h, mi] = hm.split(":").map((x) => parseInt(x, 10));
  return { h, mi };
}

interface Interval { openUtc: number; closeUtc: number; }

// ---- SessionClock -----------------------------------------------------------

export class SessionClock {
  private readonly spec?: SessionSpec;
  private readonly days: number[];

  constructor(spec?: SessionSpec) {
    this.spec = spec;
    this.days = spec?.days ?? DEFAULT_DAYS;
  }

  /** Session-anchored bucket START for `ts` at `periodMs`. No spec → UTC floor. */
  bucketOf(ts: number, periodMs: number): number {
    if (!this.spec) return Math.floor(ts / periodMs) * periodMs;
    const iv = this.sessionOf(ts);
    const anchor = iv.openUtc;
    return anchor + Math.floor((ts - anchor) / periodMs) * periodMs;
  }

  /** Bucket CLOSE — `bucketStart + periodMs`, truncated at the session close. */
  closeOf(bucketStart: number, periodMs: number): number {
    const raw = bucketStart + periodMs;
    if (!this.spec) return raw;
    // +1ms so a bucketStart that sits exactly on the open resolves to its own session.
    const iv = this.sessionOf(bucketStart + 1);
    return Math.min(raw, iv.closeUtc);
  }

  /** Is `ts` inside a trading session on a trading day? */
  isOpen(ts: number): boolean {
    if (!this.spec) return true;
    const iv = this.containingSession(ts);
    if (!iv) return false;
    const p = partsInTz(iv.openUtc, this.spec.tz);
    const weekday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    return this.days.includes(weekday);
  }

  // Session interval that `ts` belongs to. Falls back (gap/pre-open ticks) to the
  // most recent open ≤ ts, else the earliest candidate — documented in §4.
  private sessionOf(ts: number): Interval {
    const ivs = this.candidates(ts);
    const containing = ivs.find((iv) => ts >= iv.openUtc && ts < iv.closeUtc);
    if (containing) return containing;
    const past = ivs.filter((iv) => iv.openUtc <= ts).sort((a, b) => b.openUtc - a.openUtc);
    if (past.length) return past[0];
    return ivs.sort((a, b) => a.openUtc - b.openUtc)[0];
  }

  private containingSession(ts: number): Interval | null {
    return this.candidates(ts).find((iv) => ts >= iv.openUtc && ts < iv.closeUtc) ?? null;
  }

  // Candidate session intervals around `ts`: the local day of ts and the day
  // before (to catch overnight sessions whose open was yesterday).
  private candidates(ts: number): Interval[] {
    const spec = this.spec!;
    const p = partsInTz(ts, spec.tz);
    const out: Interval[] = [];
    for (const dayShift of [-1, 0]) {
      for (const s of spec.sessions) {
        const start = parseHm(s.start);
        const end = parseHm(s.end);
        const openUtc = wallToUtc(p.y, p.mo, p.d + dayShift, start.h, start.mi, spec.tz);
        const overnight = end.h < start.h || (end.h === start.h && end.mi <= start.mi);
        const closeUtc = wallToUtc(p.y, p.mo, p.d + dayShift + (overnight ? 1 : 0), end.h, end.mi, spec.tz);
        out.push({ openUtc, closeUtc });
      }
    }
    return out;
  }
}
