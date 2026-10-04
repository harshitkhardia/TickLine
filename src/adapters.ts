// The three seams the host implements (kb/ARCHITECTURE.md §2). Plus ChartOptions.

import type {
  Bar, Period, Unsubscribe, Json, SeriesSpec, SeriesResponse, SeriesPoint,
  Theme, SessionSpec,
} from "./types";

// BARS — always delivers bars, never raw ticks. Tick→bar aggregation is the
// adapter's job (use BarBuilder if your source is a tick/trade stream).
export interface Datafeed {
  getBars(symbol: string, period: Period, from: number, to: number): Promise<Bar[]>;
  subscribe(symbol: string, period: Period, onBar: (bar: Bar) => void): Unsubscribe;
  /** Optional: the [from,to] span the feed can serve. Historical/replay feeds implement
   *  it so the chart opens at the data's END (not `Date.now()`) and can page NEWER bars
   *  when scrolled right after a `jumpTo`. Live feeds omit it. */
  getRange?(symbol: string, period: Period): { from: number; to: number } | null;
}

// INDICATORS (Tier 2 only — MTF / parity / backtest-safe / custom). Standard
// indicators use in-library built-ins (addIndicator) and need no adapter (D-T4).
export interface SeriesSource {
  request(spec: SeriesSpec): Promise<SeriesResponse>;
  stream?(spec: SeriesSpec, onPoint: (p: SeriesPoint) => void): Unsubscribe;
}

// PERSISTENCE (layout + drawings). TickLine serializes to JSON; host decides where.
export interface Storage {
  load(key: string): Promise<Json | null>;
  save(key: string, value: Json): Promise<void>;
}

export interface ChartOptions {
  datafeed: Datafeed;
  series?: SeriesSource;
  storage?: Storage;
  theme?: Theme;
  timezone?: string;   // IANA name; DISPLAY only (bars stay UTC). Default "UTC" (D-T5).
  session?: SessionSpec; // absent => 24h-continuous (D-T5)
  precision?: number;
  locale?: string;
  autoResize?: boolean;
}
