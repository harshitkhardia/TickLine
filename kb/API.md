# TickLine — API Reference & Usage Guide

A standalone, framework-neutral charting library on **KLineChart v9**. You give it data through
**adapters** and drive it through a **`ChartController`**. This doc is the consumer-facing reference:
every public method, its types, and copy-paste examples.

> Design rationale is in [ARCHITECTURE.md](ARCHITECTURE.md) and the decisions in [DECISIONS.md](DECISIONS.md).
> Methods marked **`(v1.5)`** are on the roadmap and do not exist yet. Methods marked **`🔲 not yet
> implemented`** exist on the class, but calling one emits a `series` error (`retryable: false`) and does
> nothing (today: the Tier-2 series family and `movePaneSeries`). Everything else is built and tested.
> Status: [PROGRESS.md](PROGRESS.md).

---

## 1. Install & quick start

```bash
npm install tickline klinecharts@9.8.12
```

The **core is framework-neutral** (works with vanilla JS, React, Vue, Svelte). A thin React wrapper
ships as `tickline/react`.

```ts
import { createChart } from "tickline";

const chart = createChart(document.getElementById("chart")!, {
  theme: "dark",
  timezone: "Asia/Kolkata",
  datafeed: myDatafeed,        // required — see §3
  series: mySeriesSource,      // optional — Tier-2 indicators (accepted; plotSeries not built yet)
  storage: myStorage,          // optional — handed back via chart.options; you call serialize()/save
  autoResize: true,            // optional — ResizeObserver on the container
});

await chart.setSymbol("NIFTY");
await chart.setPeriod("5m");   // triggers datafeed.getBars(...) + subscribe(...)
```

That's a live candlestick chart. Everything below adds indicators, drawings, trade lines, and
multi-chart sync on top.

---

## 2. Concepts in one minute

| Concept | What it is |
|---|---|
| **`ChartController`** | The object you drive. One instance = one chart. |
| **Adapters** | You implement `Datafeed` (bars, required), `SeriesSource` (**custom/MTF** indicators, optional), `Storage` (persistence, optional). TickLine calls them; it never talks to your backend directly. |
| **Panes** | Horizontal regions. The **main pane** (`"main"`) holds candles + overlay indicators; **sub-panes** hold RSI/MACD/volume. You create/remove them explicitly. |
| **Built-in indicators** (Tier 1) | Standard indicators (EMA/MA/MACD/RSI/VOL/BOLL/KDJ…) computed **in-library** by KLineChart. `addIndicator("EMA")` — **no backend/adapter needed**. The common case. |
| **Series** (Tier 2) | A host-computed line/histogram — `{ts, value, confirmed}[]` you supply via `SeriesSource`. For what built-ins can't do: **MTF, strategy-parity, backtest-safe, or custom**. |
| **Drawings** | Overlay tools (trendline, fib, rect, …). Users draw them; you persist them. |
| **`ChartManager`** | Drives a grid of charts: one shared feed per symbol, and sync of symbol / interval / crosshair / drawings / indicators / time / date range (§7). |
| **Trade annotations** | Markers, position boxes and level lines for showing trades (§4.6). |

---

## 3. The three adapters

TickLine is data-source-agnostic. Implement these against your backend.

### 3.1 `Datafeed` — bars (required)

**Always delivers bars, never raw ticks.** If your source is a tick/trade stream, use the bundled
`BarBuilder` helper (§8.5) to aggregate.

```ts
interface Datafeed {
  // Historical backfill + scroll-back. Returns bars in [from, to] (ms epoch).
  getBars(symbol: string, period: Period, from: number, to: number): Promise<Bar[]>;

  // Live path. Push each updating/closed bar to onBar. Return an unsubscribe fn.
  subscribe(symbol: string, period: Period, onBar: (bar: Bar) => void): Unsubscribe;

  // OPTIONAL — bounded feeds (historical / backtest / replay). When present the chart
  // opens at `to` (not Date.now()) and can page NEWER bars on scroll-right after jumpTo().
  getRange?(symbol: string, period: Period): { from: number; to: number } | null;
}
```

**Built-in feeds** (no backend):

| Feed | Use |
|---|---|
| `new StaticDatafeed().set(symbol, period, bars \| columns)` | In-memory bars (backtests, notebooks, fixtures). Serves whatever window the chart asks for by binary search, so ~150k 1m bars stay responsive. `barsFromColumns({ts, open, high, low, close, volume?})` converts columnar data. |
| `new ReplayDatafeed(bars, { start?, speed? })` | Bar replay. Only bars up to the cursor exist. `play() / pause() / toggle() / step(n) / seek(indexOrTs) / setSpeed(barsPerSec)`, `state`, `onState(cb)`. Wire seeks to a chart with `attachReplay(chart, replay)`. |

Example (REST backfill plus a WebSocket of ticks; QuantPrime's real adapter is described in [integrations/quantprime.md](integrations/quantprime.md)):

```ts
const myDatafeed: Datafeed = {
  async getBars(symbol, period, from, to) {
    const days = Math.ceil((to - from) / 86_400_000);
    const { bars } = await api.history(tokenOf(symbol), period, days);
    // NOTE: many backends (incl. QuantPrime) ship `ts` as a NAIVE-UTC ISO string
    // ("2026-07-04T12:34:56.789000", no "Z"). Append "Z" before parsing so JS
    // reads it as UTC; otherwise every bar shifts by the host's local offset.
    return bars.map((b) => ({ ...b, ts: Date.parse(b.ts + "Z") }));   // -> Bar {ts: ms epoch}
  },
  subscribe(symbol, period, onBar) {
    const builder = new BarBuilder(period);    // ticks -> bars (see §8.5)
    const unsub = ws.subscribeTicks(tokenOf(symbol), (tick) => {
      const bar = builder.push(tick);          // returns the current (updating) bar
      onBar(bar);
    });
    return unsub;
  },
};
```

### 3.2 `SeriesSource` — custom/MTF indicators (optional, Tier 2)

**You only need this for the Tier-2 cases** (D-T4): multi-timeframe, strategy-parity, backtest-safe, or
genuinely custom indicators. **Standard indicators (EMA/MACD/RSI/VOL/…) need no `SeriesSource`** — use
the in-library built-ins (`addIndicator`, §4.4). Tier-2 series are **computed on your side** (e.g. a
Python engine); see the **MTF contract** ([ARCHITECTURE.md §4](ARCHITECTURE.md)) — values must be
**forward-filled dense** and flagged `confirmed`.

```ts
interface SeriesSource {
  // One-shot compute for the current range.
  request(spec: SeriesSpec): Promise<SeriesResponse>;

  // Optional live updates as bars form.
  stream?(spec: SeriesSpec, onPoint: (p: SeriesPoint) => void): Unsubscribe;
}
```

### 3.3 `Storage` — persistence (optional)

Key/value JSON. TickLine serializes drawings + layout; you decide where it lives (SQLite, file,
localStorage, …).

```ts
interface Storage {
  load(key: string): Promise<Json | null>;
  save(key: string, value: Json): Promise<void>;
}
```

---

## 4. `ChartController` API

Grouped by concern. `create*` returns the controller; all async operations return `Promise`.

### 4.1 Lifecycle

| Method | Signature | Notes |
|---|---|---|
| `createChart` | `(el: HTMLElement, opts: ChartOptions) => ChartController` | Factory. |
| `dispose` | `() => void` | Tears down listeners, subscriptions, KLineChart instance. |
| `resize` | `() => void` | Call on container resize (or pass `autoResize: true` in opts). |
| `setLoading` | `(state: "loading" \| "empty" \| "error" \| "ready") => void` | Overlay state. |

### 4.2 Data

| Method | Signature | Notes |
|---|---|---|
| `setSymbol` | `(symbol: string) => Promise<void>` | Switches instrument: unsubscribes, fetches the initial window ending at `getRange().to` (or now, for live feeds), then re-subscribes. The window is 7 days or 500 bars, whichever is longer, capped at 20 000 bars, so daily charts aren't empty and second-level charts don't request ~600k bars. No-op until a symbol is set. |
| `setPeriod` | `(period: Period) => Promise<void>` | Switches timeframe, same reload as `setSymbol`. Any integer period parses (`"17m"`, `"2h"`). |
| `setData` | `(bars: Bar[]) => void` | Replace all bars (rarely needed; usually the datafeed drives). |
| `updateData` | `(bar: Bar) => void` | **Manual escape hatch.** Upserts the newest bar (same `ts` replaces, newer `ts` appends). Live updates normally arrive via `Datafeed.subscribe`. |
| `prependData` | `(bars: Bar[]) => void` | ⚠ **Known limitation:** implemented as per-bar `updateData`, and v9 ignores bars **older** than the newest, so this does not actually prepend history. Scroll-back backfill does **not** use it (it goes through the load callback), so normal use is unaffected. |
| `clearData` | `() => void` | Empties the chart. |
| `refresh` | `() => Promise<void>` | Re-fetch the current symbol/period from the datafeed (used after a replay seek). |
| `jumpTo` | `(ts: number) => Promise<void>` | Centre `ts` on screen. If it is outside the loaded bars, reloads a window around it. Bounded feeds then page older **and** newer bars on scroll. |

Scroll-back is **automatic**. When the user scrolls to the oldest loaded bar, TickLine requests the
previous window from `Datafeed.getBars` and prepends them. **`needHistory`** fires at the same moment; it is
informational (logging, prefetch), and you don't need to answer it.

### 4.3 Panes

The **main pane** (`"main"`) always exists. Create sub-panes for RSI/MACD/volume.

| Method | Signature | Notes |
|---|---|---|
| `createPane` | `(opts?: PaneOptions) => PaneId` | Returns the new pane id. |
| `removePane` | `(paneId: PaneId) => void` | Removes the pane + its series. Main pane can't be removed. |
| `resizePane` | `(paneId: PaneId, height: number) => void` | Height in px. |
| `movePaneSeries` | `(seriesId: string, paneId: PaneId) => void` | 🔲 not yet implemented (depends on Tier-2 series). |
| `getPanes` | `() => PaneInfo[]` | Panes that currently hold something (from TickLine's registry). `height` is the last height set via `createPane`/`resizePane`, or `0` if never set. |

> **Panes appear lazily.** v9 has no standalone pane API, so `createPane()` only reserves an id; the pane
> appears when the first indicator is added to it.
>
> **Auto-remove rule:** removing the last indicator from a sub-pane auto-removes the pane unless it was
> created with `sticky: true`. The main pane is never removed.

### 4.4 Indicators & series

**Tier 1 — built-in indicators** (KLineChart-computed, no backend):

| Method | Signature | Notes |
|---|---|---|
| `addIndicator` | `(name: BuiltinIndicator, paneId?: PaneId, params?: number[]) => IndicatorId` | e.g. `addIndicator("EMA", "main", [20, 50])`. Omit `paneId` → main pane. Legend/tooltip/settings come free. |
| `removeIndicator` | `(id: IndicatorId) => void` | Remove one built-in. |
| `listIndicators` | `() => { id: IndicatorId; name: string; paneId: PaneId }[]` | Current built-ins. |

`BuiltinIndicator` names TickLine types explicitly: EMA, MA, SMA, MACD, RSI, VOL, BOLL, KDJ, SAR, WR. Any
other v9 built-in passes as a string. Verified registered in `9.8.12`: AVP, AO, BIAS, BOLL, BRAR, BBI,
CCI, CR, DMA, DMI, EMV, EMA, MTM, MA, MACD, OBV, PVT, PSY, ROC, RSI, SMA, KDJ, SAR, TRIX, VOL, VR, WR.

**Tier 2 — host-computed series** (via `SeriesSource`; for MTF / parity / backtest-safe / custom).
🔲 **Not yet implemented.** Calling them today emits a `series` error and does nothing (`plotSeries` returns `""`). The contract below is the locked design:

| Method | Signature | Notes |
|---|---|---|
| `plotSeries` | `(paneId: PaneId, points: SeriesPoint[], meta: SeriesMeta) => SeriesId` | 🔲 Draw a host-computed series. |
| `updateSeries` | `(id: SeriesId, point: SeriesPoint) => void` | 🔲 **Idempotent upsert by timestamp** (§8.2). |
| `removeSeries` | `(id: SeriesId) => void` | 🔲 Remove one series. |

### 4.5 Drawings

| Method | Signature | Notes |
|---|---|---|
| `draw` | `(tool: DrawTool, points?: Point[], style?: DrawStyle) => DrawingId` | Omit `points` to start **interactive** draw mode (user clicks to place). **Working v1 tools:** `trendline`, `ray`, `hline`, `vline`, `rect`, `fib`, `text`. Any registered v9 overlay name also works (`"priceChannelLine"`, `"parallelStraightLine"`, …). The other `DrawTool` names (`fibTime`, `channel`, `pitchfork`, `gann`, `position`) are v1.5 and draw nothing yet. `style` is recorded for `serialize()` but not yet applied to the overlay. |
| `updateDrawing` | `(id: DrawingId, points: Point[]) => void` | Move/edit a drawing programmatically. Emits `drawingModified`. |
| `removeDrawing` | `(id: DrawingId) => void` | Remove one. Emits `drawingRemoved`. |
| `clearDrawings` | `() => void` | Remove all drawings (and the synced cursor). Trade annotations are re-drawn. |
| `serialize` | `() => LayoutSnapshot` | Drawings + panes + view range (R-T2). `seriesSpecs` is always `[]` until Tier 2 lands. |
| `restore` | `(json: LayoutSnapshot) => void` | Clears drawings, re-creates the saved ones **silently** (no `drawingCreated`), re-applies pane heights and the view range. |

Emits **`drawingCreated` / `drawingModified` / `drawingRemoved`** with `{ id, tool, points }` — persist
these to `Storage`.

### 4.6 Trade primitives (wrapper over the overlay engine)

| Method | Signature | Notes |
|---|---|---|
| `priceLine` | `(id: string, price: number, style?: PriceLineStyle) => void` | Entry/SL/TP line + axis label. Upserts by `id`. |
| `removePriceLine` | `(id: string) => void` | |
| `setMarkers` | `(marks: Marker[]) => void` | Buy/sell arrows, circles, squares on bars. Replaces the set. Anchored at the bar high/low/close unless `price` is given. |
| `setPositions` | `(p: TradePosition[]) => void` | TradingView-style Long/Short Position boxes: TP zone (green), SL zone (red), entry line, dashed entry→exit line and an R-multiple result chip once closed. Replaces the set. |
| `setLevels` | `(l: LevelLine[]) => void` | Horizontal levels over a time span (PDH/PDL, …) with a right-end label. Replaces the set. |
| `clearTradeAnnotations` | `() => void` | Removes all markers, positions and levels. |

Markers, positions and levels are **annotations, not drawings**: they aren't user-editable, aren't
serialized, and survive `clearDrawings()`. Each one is drawn only while its bar is loaded. So with chunked
loading they appear as you scroll, and in **replay** they appear when the replay reaches them (an open
position's box grows bar by bar until its exit).

### 4.7 View & sync

| Method | Signature | Notes |
|---|---|---|
| `setVisibleRange` | `(from: number, to: number) => void` | Timestamps (ms). Sync the **window**, not zoom. Fits the bars **loaded** in `[from, to]` across the container width and pins `to` at the right edge. Counting loaded bars means nights and weekends don't squash the candles. If the window isn't loaded, it falls back to a wall-clock estimate. |
| `scrollTo` | `(ts: number) => void` | Brings the bar **to the right edge** (v9 `scrollToTimestamp`). Use `jumpTo` to centre it, or to reach a time outside the loaded bars. |
| `zoomTo` | `(ts: number, factor?: number) => void` | Omit `factor` to scroll only. |
| `setCrosshair` | `(ts: number, value?: number) => void` | Linked cursor: a dashed vertical line at `ts` (+ horizontal at `value`). Overlay-based (v9 has no crosshair setter). Used by sync. `ts = 0` clears it. |
| `clearCrosshair` | `() => void` | Remove the linked cursor. |
| `getVisibleRange` | `() => { from: number; to: number }` | Timestamps (ms). v9 itself reports bar indices; TickLine converts them. |
| `setTimezone` | `(tz: string) => void` | **v1.** IANA name (e.g. `"Asia/Kolkata"`). Display only — bars stay UTC (D-T5). Native v9. |
| `setTheme` | `(theme: Theme) => void` | Runtime theme swap. `"dark"`/`"light"` apply TickLine's full palettes **and** paint the container background (v9's own `"dark"` only recolours grid/axes over a transparent canvas). An object passes through as raw v9 styles. |
| `setPrecision` | `(p: number) => void` | **(v1.5)** |
| `screenshot` | `() => string` | **(v1.5)** PNG data URL. |

### 4.8 Groups (multi-chart sync)

| Method | Signature | Notes |
|---|---|---|
| `linkGroup` | `(groupId: string \| null) => void` | Join/leave a sync group. `null` = unlinked. |
| `syncConfig` | `(cfg: SyncConfig) => void` | Which dimensions this chart syncs (see §7). |

> These only work on a chart that has a `SyncController` attached, and `ChartManager.addChart` does that for
> you. On a bare `createChart` chart, `linkGroup`/`syncConfig` record state and do nothing else. Use
> `ChartManager` for multi-chart layouts (§7).

### 4.9 Accessors

| Getter | Type | Notes |
|---|---|---|
| `symbolId` / `periodId` | `string` / `Period` | Current symbol and period. |
| `group` | `string \| null` | Current link group. |
| `loadingState` | `LoadingState` | `"loading" \| "empty" \| "error" \| "ready"`. |
| `options` | `Readonly<ChartOptions>` | The options the chart was created with. |
| `raw` | KLineChart `Chart` | Escape hatch to the v9 instance. |

### 4.10 Events

```ts
chart.on("needHistory",     (e: { symbol, period, before: number }) => {...});   // informational
chart.on("crosshairMove",   (e: { ts: number, value: number }) => {...});
chart.on("visibleRangeChange", (e: { from: number, to: number }) => {...});
chart.on("click",           (e: { ts: number, value: number }) => {...});
chart.on("drawingCreated",  (e: { id, tool, points }) => {...});
chart.on("drawingModified", (e: { id, tool, points }) => {...});
chart.on("drawingRemoved",  (e: { id }) => {...});
chart.on("error",           (e: TickLineError) => {...});   // §8.3 / ARCHITECTURE.md §10
const off = chart.on(...);  // returns an unsubscribe fn
```

---

## 5. Types

```ts
type Period = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | string;
type Unsubscribe = () => void;
type Json = Record<string, unknown> | unknown[];

interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number; }
                                          // ts = ms epoch (UTC)

interface SeriesPoint { ts: number; value: number; confirmed: boolean; }
                                          // confirmed=false => provisional (still-forming bar)

interface SeriesMeta {                    // per-series, NOT per-point
  label: string;                          // legend + crosshair tooltip, e.g. "EMA 15m 20"
  color?: string;
  precision?: number;
  type?: "line" | "histogram" | "area" | "baseline";
  group?: string;                         // e.g. MACD's 3 series share a group
}

interface SeriesSpec {                    // request input — carries the indicator's OWN timeframe
  symbol: string; indicator: string; params: number[];
  timeframe: Period;                      // may differ from the chart's base (MTF)
  from?: number; to?: number;
}
// meta is per-series, so a request returns { meta, points } (R-T1, ARCHITECTURE.md §9).
interface SeriesResponse { meta: SeriesMeta; points: SeriesPoint[]; }

interface PaneOptions { height?: number; position?: "below" | "above"; sticky?: boolean; id?: string; }
type PaneId = string;
type IndicatorId = string;

// Tier-1 built-ins (KLineChart's registered set — computed in-library, no backend).
type BuiltinIndicator =
  | "EMA" | "MA" | "SMA" | "MACD" | "RSI" | "VOL" | "BOLL" | "KDJ" | "SAR" | "WR" | string;

type DrawTool =
  | "trendline" | "ray" | "hline" | "vline" | "rect" | "text"
  | "fib" | "fibTime" | "channel" | "pitchfork" | "gann" | "position" /* …v1.5 tools */;
interface Point { ts: number; value: number; }
interface DrawStyle { color?: string; width?: number; dash?: number[]; fillColor?: string; }

interface Marker { ts: number; position: "aboveBar" | "belowBar" | "inBar";
                   shape: "arrowUp" | "arrowDown" | "circle" | "square"; color?: string; text?: string;
                   price?: number; /* anchor; default bar high/low/close */ }
interface TradePosition { id?: string; side: "long" | "short"; entryTs: number; entryPrice: number;
                          stopPrice?: number; targetPrice?: number;
                          exitTs?: number; exitPrice?: number; /* omitted => open */
                          qty?: number; label?: string; }
interface LevelLine { id?: string; fromTs: number; toTs: number; price: number;
                      color?: string; width?: number; dash?: boolean; label?: string; }
interface ReplayState { index: number; total: number; ts: number; playing: boolean; speed: number; }
interface PriceLineStyle { color?: string; width?: number; dash?: number[]; label?: string; axisLabel?: boolean; }

interface ChartOptions {
  datafeed: Datafeed; series?: SeriesSource; storage?: Storage;
  theme?: "dark" | "light" | Theme;
  timezone?: string;          // IANA name; DISPLAY only (bars stay UTC). Default "UTC" (D-T5).
  session?: SessionSpec;      // trading hours; absent => 24h-continuous (D-T5)
  precision?: number;         // applied to BOTH price and volume (v9 sets them together)
  locale?: string; autoResize?: boolean;
}
// NOTE: a single chart does not use `session` yet (its bars come from the feed as-is).
// Session-anchored bucketing lives in SessionClock / ChartManager's per-symbol `session` (§7, §8.6).
// Trading-hours descriptor — host-supplied, separate from display timezone (D-T5).
interface SessionSpec {
  tz: string;                 // IANA zone the session times are expressed in, e.g. "Asia/Kolkata"
  days?: number[];            // trading weekdays (0=Sun … 6=Sat); default Mon–Fri
  sessions: { start: string; end: string }[];   // "HH:mm" ranges, e.g. [{start:"09:15", end:"15:30"}]
}
// Multi-chart sync dimensions (D-CM4). Independent flags; crosshair/drawings/indicators are
// partitioned BY SYMBOL. symbol/interval/indicators are ChartManager command fan-outs.
interface SyncConfig {
  symbol?: boolean; interval?: boolean;                       // whole layout
  crosshair?: boolean; drawings?: boolean; indicators?: boolean; // same-symbol charts only
  time?: boolean; dateRange?: boolean;                        // whole layout
}

// Layout snapshot returned by serialize() and consumed by restore() — R-T2, ARCHITECTURE.md §9.
interface LayoutSnapshot {
  version: number;                      // schema version for future migrations (v1 = 1)
  drawings: DrawingSnapshot[];          // from TickLine's own overlay registry (v9 has no bulk export)
  panes: PaneInfo[];                    // arrangement + heights
  seriesSpecs: SeriesSpecEntry[];       // specs only (DATA is never stored); [] until Tier 2 lands
  viewRange: { from: number; to: number };
}
interface DrawingSnapshot { id: DrawingId; tool: DrawTool; points: Point[]; style?: DrawStyle; }
interface SeriesSpecEntry { id: SeriesId; spec: SeriesSpec; paneId: PaneId; meta: SeriesMeta; }
interface GridSnapshot { version: number; cells: { symbol: string; period: Period; layout: LayoutSnapshot }[]; }
type LoadingState = "loading" | "empty" | "error" | "ready";
interface TickLineError {               // ARCHITECTURE.md §10
  kind: "datafeed" | "series" | "storage" | "internal";
  op: string; message: string; cause?: unknown; retryable: boolean;
}
```

---

## 6. Guides

### 6.1 An indicator on the main pane (EMA overlay)

**Tier 1 — built-in, the common case (no backend):**
```ts
const emaId = chart.addIndicator("EMA", "main", [20, 50]);   // KLineChart computes + overlays
```

Tier 2 — only if you need a *host-computed* EMA (e.g. to match a strategy's `ta.ema`). 🔲 Design
contract; `plotSeries` does nothing until Tier 2 lands:
```ts
const spec = { symbol: "NIFTY", indicator: "EMA", params: [20], timeframe: "5m" };
const { meta, points } = await mySeriesSource.request(spec);
const emaId = chart.plotSeries("main", points, meta);
```

### 6.2 A sub-pane indicator (RSI)

**Tier 1 — built-in into its own pane:**
```ts
const rsiPane = chart.createPane({ height: 120 });
chart.addIndicator("RSI", rsiPane, [14]);
// removing the RSI indicator later auto-removes the pane (unless created sticky)
```

### 6.3 Multi-timeframe indicator (15m EMA on a 1m chart) — 🔲 Tier 2, design contract

The **SeriesSource returns forward-filled dense** points — one value per **1m** bar, holding the last
closed 15m value, each flagged `confirmed`:

```ts
// chart base = 1m; indicator timeframe = 15m
const { meta, points } = await mySeriesSource.request(
  { symbol: "NIFTY", indicator: "EMA", params: [20], timeframe: "15m" });
// points: [{ts: 09:00, value: 21340, confirmed:true}, {ts: 09:01, value: 21340, confirmed:true}, ...]
//         the value only *changes* at each 15m close; provisional=false unless you opted into live
chart.plotSeries("main", points, { ...meta, label: "EMA 15m 20" });
```

> Backtests must use `confirmed`-only values to avoid look-ahead. See ARCHITECTURE.md §4.

### 6.4 Drawing tools + persistence

```ts
// interactive: user clicks two points to place a trendline
chart.draw("trendline");

// persist on every change
chart.on("drawingCreated",  () => myStorage.save(layoutKey, chart.serialize()));
chart.on("drawingModified", () => myStorage.save(layoutKey, chart.serialize()));
chart.on("drawingRemoved",  () => myStorage.save(layoutKey, chart.serialize()));

// restore on load
const saved = await myStorage.load(layoutKey);
if (saved) chart.restore(saved);
```

### 6.5 Trade lines & signal markers

```ts
// priceLine: v9's native overlay, axis label = the price. Only `color`/`width` are applied today;
// `label`/`dash`/`axisLabel` are accepted but ignored (a text label needs a custom overlay, v1.5).
chart.priceLine("entry", 21500, { color: "#a78bfa" });
chart.priceLine("sl",    21350, { color: "#ef4444" });
chart.priceLine("tp",    21800, { color: "#34d399" });

chart.setMarkers([
  { ts: 1719800000000, position: "belowBar", shape: "arrowUp",   color: "#34d399", text: "BUY" },
  { ts: 1719803600000, position: "aboveBar", shape: "arrowDown", color: "#ef4444", text: "SELL" },
]);

chart.setPositions([{
  side: "long", entryTs: 1719800000000, entryPrice: 21500, stopPrice: 21350, targetPrice: 21800,
  exitTs: 1719803600000, exitPrice: 21800, label: "PDL sweep",
}]);                                                    // box + "+2.00R (+300.00)" chip
chart.setLevels([{ fromTs: dayOpen, toTs: dayClose, price: pdh, label: "PDH", color: "#f59e0b" }]);
```

### 6.6 Backtest viewer & bar replay

`BacktestView` is a ready-made component: one chart over in-memory bars plus a toolbar with
**Chart | Replay** mode, ⏮ ▶/⏸ ▸| and speed controls, a scrubber, and ◀ trade ▶ navigation. Space and →
work as shortcuts when it has focus. The Jupyter widget mounts this same component.

```ts
import { BacktestView } from "tickline";

const view = new BacktestView(el, {
  bars,                        // Bar[] or columnar { ts, open, high, low, close, volume? }
  markers, positions, levels,  // optional annotations
  symbol: "NIFTY", period: "1m", title: "NIFTY 1m · PDL sweep",
  timezone: "Asia/Kolkata", theme: "dark", height: 560,
  mode: "chart",               // or "replay"
  speed: 10,                   // replay bars/sec
});
await view.gotoTrade(3);       // centre trade #4 (Replay mode: seek ~60 bars before its entry)
await view.setMode("replay");
view.replayFeed?.play();
```

Without a bundler, `dist/standalone/tickline.global.js` (klinecharts inlined) exposes everything as the
global `TickLine`, e.g. `new TickLine.BacktestView(el, …)`.

### 6.7 Jupyter (Python)

`python/` contains the `tickline-widget` package (anywidget). See [python/README.md](../python/README.md).

```python
from tickline_widget import TickLineChart, prev_day_levels
w = TickLineChart(bars_df, trades=stats["_trades"], levels=prev_day_levels(bars_df),
                  title="NIFTY 1m", timezone="Asia/Kolkata")
w.replay(speed=20)
```

---

## 7. Multi-chart layouts & sync (`ChartManager`)

`ChartManager` owns the charts of a grid, one `SharedDatafeed` and one `SyncController`. You own the DOM:
which element each chart mounts in, and the grid CSS. Full spec: [CHARTMANAGER.md](CHARTMANAGER.md).

```ts
import { ChartManager } from "tickline";

const mgr = new ChartManager({
  datafeed,                                   // wrapped in a SharedDatafeed internally
  timezone: "Asia/Kolkata", theme: "dark",
  session: (sym) => NSE_SESSION,              // optional per-symbol SessionSpec (session-anchored derivation)
  sync: { symbol: false, interval: false },   // merged over the defaults below
});
const a = mgr.addChart(elA, { symbol: "NIFTY",     period: "1m" });
const b = mgr.addChart(elB, { symbol: "NIFTY",     period: "5m" });
const c = mgr.addChart(elC, { symbol: "BANKNIFTY", period: "1m" });

await mgr.setSymbol(c, "FINNIFTY");          // one chart, or every chart if `symbol` sync is on
await mgr.setPeriod(a, "17m");               // one chart, or every chart if `interval` sync is on
mgr.addIndicator(a, "EMA", "main", [20]);    // copied to same-symbol charts if `indicators` sync is on
mgr.setSync({ dateRange: false });           // toggle dimensions at runtime
```

| Method | Notes |
|---|---|
| `addChart(el, { symbol, period })` | Creates, links and loads a chart. Returns its `ChartController`. |
| `removeChart(chart)` / `disposeAll()` | Dispose one chart, or all of them. |
| `getCharts()` | Charts in insertion order. |
| `setSymbol(chart, s)` / `setPeriod(chart, p)` | Respect the `symbol` / `interval` sync flags. |
| `setSymbolAll(s)` / `setPeriodAll(p)` | Always apply to every chart. |
| `addIndicator(chart, name, paneId?, params?)` | Fans out to same-symbol charts when `indicators` is on. |
| `removeIndicator(chart, id)` | Removes it, and the same indicator (by name and main/sub-pane placement) from same-symbol charts when `indicators` is on. |
| `setSync(partial)` / `getSync()` | Change or read the live `SyncConfig`. |
| `serializeLayout()` / `restoreLayout(snap)` | `GridSnapshot` = per-cell symbol, period and `LayoutSnapshot`, restored by index onto existing cells. Sync config is not included. |

**Sync dimensions** (`SyncConfig`, D-CM4). Defaults: `symbol: false, interval: false`, everything else `true`.

| Flag | Effect | Scope |
|---|---|---|
| `symbol` / `interval` | Changing one chart's symbol/period changes all | whole layout |
| `crosshair` | Linked cursor follows the pointer | same-symbol charts |
| `drawings` | Drawings are replicated (create/move/remove) | same-symbol charts |
| `indicators` | `mgr.addIndicator` definitions are replicated (each recomputes on its own TF) | same-symbol charts |
| `time` | **Click** a bar → other charts `scrollTo` that time and show the cursor there | whole layout |
| `dateRange` | Scrolling/zooming one chart applies the same `[from,to]` window to the others | whole layout |

Rules baked in (ARCHITECTURE.md §6): **timestamp-keyed** (1m and 15m charts sync correctly), **window, not
zoom**, **echo-suppressed**, and all in the browser (nothing round-trips to a backend). Data is
deduplicated: N charts on one symbol open **one** upstream `subscribe(symbol, "1m")`, and every period is
derived from it.

Known gap: date-range sync is reactive only. It doesn't align charts on load or when the flag is switched
on.

---

## 8. Notes & helpers

### 8.1 Live vs manual updates
`Datafeed.subscribe` is the **live path** — TickLine applies each bar. `updateData()` is only for
imperative/replay pushes without a subscription.

### 8.2 Series desync is handled for you (🔲 Tier-2 design)
The live bar and live series streams are independent, but `updateSeries` is an **idempotent
upsert-by-timestamp**: a late/dropped indicator frame self-heals on the next update, and a closed
bar's `confirmed` value overwrites the earlier provisional. TickLine never blocks bar rendering.

### 8.3 Errors
Adapter rejections and internal failures surface via `setLoading("error")` **and** an `on("error")`
event. Full contract in [ARCHITECTURE.md §10](ARCHITECTURE.md):

```ts
chart.on("error", (e: TickLineError) => log(e));
interface TickLineError {
  kind: "datafeed" | "series" | "storage" | "internal";
  op: string;                         // e.g. "setSymbol/setPeriod", "getBars(backfill)", "plotSeries"
  message: string;
  cause?: unknown;                    // original adapter error
  retryable: boolean;                 // transient (network) vs fatal (bad symbol/contract)
}
```

**Adapters must not throw synchronously.** Return a rejected `Promise` from `getBars`. TickLine **never
retries**; `retryable` tells you whether to bother. Today two kinds are emitted: `datafeed` (always
`retryable: true`) and `series`, from the unbuilt Tier-2 methods (`retryable: false`). A `getBars` failure during scroll-back keeps the existing bars (the error overlay is
semi-transparent). The next successful `setSymbol`/`setPeriod` resets the state to `"ready"`.
**Stream drops are the adapter's job:** TickLine cannot see a dead `subscribe` stream, so detect it in the
adapter, then resubscribe or surface it yourself.

### 8.4 `serialize()` scope
Returns a `LayoutSnapshot` = `{ version, drawings, panes, seriesSpecs, viewRange }` (R-T2,
ARCHITECTURE.md §9). **Series data is never stored**, only specs; once Tier 2 lands, `restore()` will
re-fetch via `SeriesSource.request` (today `seriesSpecs` is always `[]`). Built-in indicators and trade
annotations are **not** in the snapshot, so re-add them after `restore()`. Key it per `(symbol, period)`
in your `Storage` if you want per-instrument layouts. TickLine never calls `Storage` itself: you
`save(key, chart.serialize())` on the drawing events and `restore()` on load (§6.4). The `version` field
enables future snapshot migrations.

### 8.5 `BarBuilder` (tick → bar)
```ts
// Single period. Any integer period parses ("17m"). The `timezone` option is accepted but unused.
// Without `session`: 24h-continuous, UTC-floored buckets (D-T5).
// With `session`: buckets anchor at the session open (NSE 1h bars at 09:15, 10:15, …).
// For many periods off one stream, use MultiPeriodAggregator (§8.6).
const b = new BarBuilder("5m", { session: NSE_SESSION });
const bar = b.push({ ts, price, volume });   // returns the current (updating) bar; rolls at boundary
b.peek();                                    // the bar being built, or null
```

### 8.6 Time & aggregation helpers

| Export | Use |
|---|---|
| `periodToMs(p)` | `"<int><s\|m\|h\|d\|w>"` → ms (`"17m"` → 1 020 000). Throws on anything else. |
| `new SessionClock(spec?)` | Session-anchored bucketing: `bucketOf(ts, periodMs)`, `closeOf(bucketStart, periodMs)` (last bucket truncated at the session close), `isOpen(ts)`. No spec → UTC floor. DST-safe, Intl only. |
| `new MultiPeriodAggregator(periods, clock?)` | One 1m stream → many periods. `seed1m(bars)`, `pushTick(tick)` / `pushForming1m(bar)` → forming bars per period, `push1mClose(bar)` to reconcile from authoritative 1m, `onClose(cb)` for confirmed bars, `addPeriod(p)`. |
| `createSharedDatafeed(base, { session?, seedMs? })` | Wraps a `Datafeed` so N charts on one symbol share one upstream 1m `subscribe`, with every period derived from it. `getBars` and `getRange` pass through. Used by `ChartManager`. |

---

## 9. Compatibility

- **KLineChart**: peer dependency, pinned `9.8.12` (v1). Install it next to the npm build. Only the
  standalone bundle and the Jupyter widget bundle it.
- **Frameworks**: neutral core + `tickline/react` wrapper. Vue/Svelte wrappers are community/roadmap.
- **Module**: ESM + CJS. TypeScript types shipped. Plus `tickline/standalone`, an IIFE bundle with
  klinecharts inlined (global `TickLine`).
- **License**: see `LICENSE`. KLineChart is Apache-2.0; attribution is in `NOTICE` (it matters for the
  standalone and widget bundles, which include it).
