// Public types — mirrors kb/API.md §5. Framework-neutral; no KLineChart types leak here.

export type Period =
  | "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w"
  | (string & {});
export type Unsubscribe = () => void;
export type Json = Record<string, unknown> | unknown[];

export interface Bar {
  ts: number; // ms epoch (UTC)
  open: number; high: number; low: number; close: number; volume: number;
}

export interface SeriesPoint {
  ts: number;
  value: number;
  confirmed: boolean; // false => provisional (still-forming bar)
}

export interface SeriesMeta {
  label: string; // legend + crosshair tooltip, e.g. "EMA 15m 20"
  color?: string;
  precision?: number;
  type?: "line" | "histogram" | "area" | "baseline";
  group?: string; // e.g. MACD's 3 series share a group
}

export interface SeriesSpec {
  symbol: string;
  indicator: string;
  params: number[];
  timeframe: Period; // may differ from the chart's base (MTF)
  from?: number;
  to?: number;
}
export interface SeriesResponse { meta: SeriesMeta; points: SeriesPoint[]; }

export type PaneId = string;
export type SeriesId = string;
export type IndicatorId = string;
export type DrawingId = string;

export interface PaneOptions {
  height?: number;
  position?: "below" | "above";
  sticky?: boolean;
  id?: string;
}
export interface PaneInfo { id: PaneId; height: number; }

// Tier-1 built-ins (KLineChart's registered set — computed in-library, no backend).
export type BuiltinIndicator =
  | "EMA" | "MA" | "SMA" | "MACD" | "RSI" | "VOL" | "BOLL" | "KDJ" | "SAR" | "WR"
  | (string & {});

export type DrawTool =
  | "trendline" | "ray" | "hline" | "vline" | "rect" | "text"
  | "fib" | "fibTime" | "channel" | "pitchfork" | "gann" | "position"
  | (string & {}); // …v1.5 tools

export interface Point { ts: number; value: number; }
export interface DrawStyle { color?: string; width?: number; dash?: number[]; fillColor?: string; }

export interface Marker {
  ts: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color?: string;
  text?: string;
  /** Anchor price. Omitted => the bar's high (aboveBar) / low (belowBar) / close (inBar). */
  price?: number;
}

// TradingView-style Long/Short Position box: entry->target (profit zone) and
// entry->stop (loss zone), plus the realised exit when the trade has closed.
export interface TradePosition {
  id?: string;
  side: "long" | "short";
  entryTs: number;
  entryPrice: number;
  stopPrice?: number;
  targetPrice?: number;
  exitTs?: number;   // omitted => still open (box extends to the newest loaded bar)
  exitPrice?: number;
  qty?: number;
  label?: string;    // e.g. "PDL sweep · engulfing"
}

// Horizontal level over a time span (PDH/PDL, VWAP bands, …). Not a drawing:
// not user-editable, not serialized.
export interface LevelLine {
  id?: string;
  fromTs: number;
  toTs: number;
  price: number;
  color?: string;
  width?: number;
  dash?: boolean;
  label?: string;
}

export interface ReplayState {
  index: number;    // index of the newest revealed bar
  total: number;
  ts: number;       // timestamp of the newest revealed bar
  playing: boolean;
  speed: number;    // bars per second
}
export interface PriceLineStyle {
  color?: string; width?: number; dash?: number[]; label?: string; axisLabel?: boolean;
}

export type Theme = "dark" | "light" | Record<string, unknown>;

// Trading-hours descriptor — host-supplied, SEPARATE from display timezone (D-T5).
export interface SessionSpec {
  tz: string; // IANA zone the session times are expressed in, e.g. "Asia/Kolkata"
  days?: number[]; // trading weekdays (0=Sun … 6=Sat); default Mon–Fri
  sessions: { start: string; end: string }[]; // "HH:mm" ranges
}

// Multi-chart sync dimensions (kb/CHARTMANAGER.md §5, D-CM4). Independent flags;
// crosshair/drawings/indicators are partitioned by symbol.
export interface SyncConfig {
  symbol?: boolean;      // whole layout shares one symbol (ChartManager fan-out)
  interval?: boolean;    // whole layout shares one period (ChartManager fan-out)
  crosshair?: boolean;   // linked cursor, symbol-scoped (SyncController)
  drawings?: boolean;    // replicate drawings, symbol-scoped (SyncController)
  indicators?: boolean;  // replicate indicator definitions, symbol-scoped (ChartManager fan-out)
  time?: boolean;        // click → scroll-into-frame, whole layout (SyncController)
  dateRange?: boolean;   // identical visible window, whole layout (SyncController)
}

export interface LayoutSnapshot {
  version: number; // schema version for future migrations (v1 = 1)
  drawings: DrawingSnapshot[];
  panes: PaneInfo[];
  seriesSpecs: SeriesSpecEntry[]; // specs only — DATA is re-fetched on restore
  viewRange: { from: number; to: number };
}
export interface SeriesSpecEntry {
  id: SeriesId;
  spec: SeriesSpec;
  paneId: PaneId;
  meta: SeriesMeta;
}
export interface DrawingSnapshot { id: DrawingId; tool: DrawTool; points: Point[]; style?: DrawStyle; }

// Whole-grid snapshot for ChartManager (kb/CHARTMANAGER.md §6.4).
export interface GridSnapshot {
  version: number;
  cells: { symbol: string; period: Period; layout: LayoutSnapshot }[];
}

export interface TickLineError {
  kind: "datafeed" | "series" | "storage" | "internal";
  op: string;
  message: string;
  cause?: unknown;
  retryable: boolean;
}

export type LoadingState = "loading" | "empty" | "error" | "ready";

// Event map (chart.on(type, cb)). See kb/KLINECHART_MAPPING.md for the v9 wiring.
export interface TickLineEvents {
  needHistory: { symbol: string; period: Period; before: number };
  crosshairMove: { ts: number; value: number };
  visibleRangeChange: { from: number; to: number };
  click: { ts: number; value: number };
  drawingCreated: { id: DrawingId; tool: DrawTool; points: Point[] };
  drawingModified: { id: DrawingId; tool: DrawTool; points: Point[] };
  drawingRemoved: { id: DrawingId };
  error: TickLineError;
}
