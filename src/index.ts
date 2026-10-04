// TickLine — public entry (framework-neutral core).
// React wrapper is a separate entry: `tickline/react`.

import { registerBuiltinOverlays } from "./overlays";
// Register custom overlay tools (rect, ...) that v9 lacks. Side-effect at import.
registerBuiltinOverlays();

export { createChart, ChartController } from "./ChartController";
export { BarBuilder } from "./BarBuilder";
export { SyncController } from "./SyncController";
export { SessionClock, periodToMs } from "./session";
export { MultiPeriodAggregator } from "./aggregation";
export { createSharedDatafeed } from "./SharedDatafeed";
export { ChartManager } from "./ChartManager";
export { StaticDatafeed, barsFromColumns } from "./StaticDatafeed";
export { ReplayDatafeed, attachReplay } from "./ReplayDatafeed";
export { BacktestView } from "./BacktestView";
export { THEMES } from "./theme";

export type { SyncBinder } from "./ChartController";
export type { BarColumns } from "./StaticDatafeed";
export type { ReplayOptions } from "./ReplayDatafeed";
export type { BacktestViewOptions, BacktestAnnotations } from "./BacktestView";
export type { Datafeed, SeriesSource, Storage, ChartOptions } from "./adapters";
export type { Tick, BarBuilderOptions } from "./BarBuilder";
export type { SharedDatafeedOptions } from "./SharedDatafeed";
export type { ChartManagerOptions } from "./ChartManager";
export type * from "./types";
