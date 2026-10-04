# TickLine — ChartManager (multi-chart grid)

## Summary

- **What:** `ChartManager` drives a grid of charts the way `ChartController` drives one: it creates and links charts, shares one data feed per symbol, derives every timeframe from 1m, and syncs symbol, interval, crosshair, drawings, indicators, time and date range.
- **Where it sits:** inside TickLine, on top of `ChartController`. It wraps the host's `Datafeed` in a `SharedDatafeed` and attaches a `SyncController`. The host owns the DOM and the grid CSS.
- **Rules it must not break:** sync is keyed by timestamp, never bar index; it syncs the time window, not the zoom; every replay is echo-suppressed; crosshair, drawings and indicators only sync between charts of the same symbol.
- **Status:** ✅ built and in the grid demo (`npm run demo:grid`). Open polish is listed in §8.

> Extends [ARCHITECTURE.md](ARCHITECTURE.md) (§2 adapters, §4 `confirmed` contract, §6 sync) and [API.md](API.md) §7. The decisions D-CM1–D-CM6 are in [DECISIONS.md](DECISIONS.md#multi-chart-grid-d-cm).

## 0. What we're building & why

A **`ChartManager`** — the object that drives a *grid of charts* (TradingView-style: 1×1 … 4×4), the
way a single [ChartController](../src/ChartController.ts) drives one chart. Motivating layout: a **2×2 of
NIFTY 1m, NIFTY 5m, BankNifty 1m, BankNifty 5m**, where:

1. Higher timeframes (5m/15m/…) are **derived client-side from one base stream per symbol** — not
   fetched per-TF at the live edge (§2).
2. The forming candle is **tick/quote-driven** for responsiveness, then **reconciled from 1m bars on
   close** (§3, the hybrid model — your requirement).
3. Periods are **arbitrary** (1/3/5/15/**17**m…) with **session-anchored** bucketing off the 09:15 open
   (§4).
4. Charts sync across **independent dimensions** — Symbol, Interval, **Crosshair / Drawings / Indicators**
   (the last three symbol-scoped), Time, Date range (§5, your TradingView-panel requirement).

ChartManager lives in **TickLine core**, not the consumer: D-T1 makes TickLine consumer-neutral and §6
already puts multi-chart orchestration (`SyncController`) inside the library. ChartManager is the same
category. The base tick feed + 1m authority stay adapter-side (QuantPrime); the resampling,
reconciliation, and sync are generic.

---

## 1. Decisions

The six calls behind this design, in one line each. Full wording: [DECISIONS.md](DECISIONS.md#multi-chart-grid-d-cm).

- **D-CM1:** derive higher timeframes from one 1m stream per symbol at the live edge (§2).
- **D-CM2:** the forming bar is provisional from ticks, then rebuilt from closed 1m bars (§3).
- **D-CM3:** any integer-minute period, anchored at the session open (§4).
- **D-CM4:** seven independent sync flags; crosshair, drawings and indicators are same-symbol only; time sync is click-only (§5).
- **D-CM5:** one `SharedDatafeed` per manager owns the 1m spine (§6.3).
- **D-CM6:** grid layouts are host-side templates over `addChart` (§6.5).

---

## 2. Derive-from-base (D-CM1) — the data topology

```
 backend                          SharedDatafeed (per manager)                    charts
 ───────                          ────────────────────────────                    ──────
 /history?tf=1m,5m,15m ─── backfill (per TF, authoritative) ───────────────▶ each chart's initial bars
 /ws/ticks?tokens=N,BN ─┐
                        │   ┌── NIFTY spine ──┐  MultiPeriodAggregator ──▶ NIFTY 1m chart
   one socket,          ├──▶│ 1m buffer+ticks │──┤                      └─▶ NIFTY 5m chart
   many symbols         │   └─────────────────┘  (session-anchored)
                        │   ┌ BANKNIFTY spine ┐  MultiPeriodAggregator ──▶ BANKNIFTY 1m chart
                        └──▶│ 1m buffer+ticks │──┤                      └─▶ BANKNIFTY 5m chart
                            └─────────────────┘
```

- **Backfill** stays per-TF (`getBars(sym, tf, from, to)`): cheap for the host to serve. We do **not** resample long 1m history
  client-side.
- **Live tail** is derived: one upstream tick sub per symbol → the aggregator produces every requested TF.
- **Seam** between backfilled TF-history and derived live tail: the aggregator seeds its first bucket to the
  boundary of the last backfilled bar, so no duplicate/short bar at the join. Because reconciliation (D-CM2)
  makes the closed derived bar match what the backend would report, a later refresh/backfill is idempotent.

> A host adapter that opens one connection per `subscribe()` ends up with **one connection per symbol**
> behind `SharedDatafeed` (it subscribes once per symbol, at 1m). One connection for the whole grid needs a
> multiplexing adapter on the host side ([integrations/quantprime.md](integrations/quantprime.md)).

---

## 3. The hybrid forming bar (D-CM2) — provisional-tick → confirmed-1m

Your model: *"current candle in live uses ticks/quotes; once a 15m candle closes, recalculate it from
1min."* Formalized as a **two-layer aggregation** where a higher-TF bar is always grounded in closed 1m
bars, and only the last, still-forming minute is tick-approximate:

```
higher-TF bucket [09:15 … 09:30)  (a 15m bar = fifteen 1m bars)
  ├─ 09:15…09:29 : already-closed 1m bars ──── folded (authoritative OHLCV)
  └─ 09:29…09:30 : the live-forming 1m bar ─── from ticks (provisional)

forming 15m bar shown  =  fold(closed 1m bars in bucket)  ⊕  merge(live forming 1m bar)
on 15m close           =  fold(all fifteen closed 1m bars)      → replaces the provisional (confirmed)
```

- **`⊕ merge`**: `open` = first bucket's open; `high/low` = max/min across folded + forming; `close` = live
  tick close; `volume` = Σ closed 1m volumes + forming 1m volume.
- **On close**, the last 1m closes too, so the whole 15m bar is 1m-derived. TickLine applies it via
  `updateData` (idempotent **upsert by the bar's open-timestamp**) — this is exactly the ARCHITECTURE §4.5
  rule: *"a closed bar's confirmed value overwrites the last provisional at the same T."* No new type; a
  `Bar` is still plain OHLCV, the provisional/confirmed distinction is the upsert itself.
- **Why it's worth it:** live tick feeds give approximate per-bar volume. Mock feeds send quote snapshots, and
  real broker feeds (Zerodha's `volume_traded`) report cumulative day volume with seconds-level timestamps.
  Brokers treat their historical 1m candles as the authoritative per-candle volume, so reconciling each
  closed bar from 1m data aligns the chart with the broker. Detail: [integrations/quantprime.md](integrations/quantprime.md#what-the-multi-chart-grid-needs-from-the-backend).
- **Where 1m comes from in live:** the spine's 1m bars are themselves the tick aggregator's 1m output until
  the backend exposes an authoritative 1m close stream — then D-CM2 swaps the 1m layer's source with **zero
  change** to the higher-TF logic (that's the point of layering).

**Edge cases:** a missing 1m bar inside a bucket → fold what exists, flag the bar (`gap`), let the next
backfill heal it; a late tick after close → dropped (bucket already reconciled); the forming bar spanning a
session gap (§4) closes at session end, not on the raw minute count.

---

## 4. Arbitrary session-anchored periods (D-CM3)

A plain UTC floor, `bucket = floor(ts/stepMs)*stepMs`, is **wrong for NSE** on any period that doesn't divide the offset
from UTC-midnight to 09:15:

| Period | 09:15 IST (=03:45 UTC) on a UTC grid | OK? |
|---|---|---|
| 5m | 03:45 is a 5-min boundary | ✅ |
| 10m | buckets 03:40–03:50 → open sits **mid-bucket** | ❌ |
| 15m | buckets 03:30–03:45–04:00 → first bar straddles open | ❌ |
| 17m | never aligns to wall clock at all | ❌ |

**Session-anchored bucketing** (needs the `SessionSpec` already defined in [types.ts](../src/types.ts)):

```
sessionOpen = the SessionSpec open for the tick's trading day, in session.tz   // e.g. 09:15 IST
k           = floor((ts − sessionOpen) / periodMs)
bucketStart = sessionOpen + k * periodMs
bucketEnd   = min(bucketStart + periodMs, sessionClose)                          // last bucket may be short
```

- 17m off 09:15 → 09:15, 09:32, 09:49, … last bucket truncated at 15:30.
- Multiple sessions (MCX splits, overnight) → each session re-anchors; a bucket never spans a session gap.
- `SessionSpec` **absent** → fall back to today's 24h-continuous UTC floor (D-T5) — unchanged for
  crypto/Binance.

This is the v1.5 session work moved forward. It's isolated in a `SessionClock` helper
(`bucketOf(ts, periodMs)` / `closeOf(bucketStart, periodMs)` / `isOpen(ts)`) consumed by
`MultiPeriodAggregator`, and by `BarBuilder` when it's given a `session`. Without one, `BarBuilder` keeps the
UTC floor.

---

## 5. The five sync dimensions (D-CM4)

Your panel's toggles, with **precise** semantics (they differ from TradingView's defaults where you
redefined them). All are **timestamp-keyed** and **echo-suppressed** (ARCHITECTURE §6).

| Toggle | Your intent | Precise semantics | Scope |
|---|---|---|---|
| **Symbol** | "all symbols same (nifty)" | Layout shares one symbol; changing it on any chart → `setSymbol` on all. | whole layout |
| **Interval** | "symbol diff, interval same (5m)" | Layout shares one period; changing it on any chart → `setPeriod` on all. | whole layout |
| **Crosshair** | (part of "shared … banknifty with banknifty") | The pointer position replicates across charts **of the same symbol** as a linked cursor (dashed time line + price line). | **per-symbol sub-group** |
| **Drawings** | "drawings shared … banknifty with banknifty" | Drawings replicate across charts **of the same symbol** (a trendline on NIFTY 1m appears on NIFTY 5m). | **per-symbol sub-group** |
| **Indicators** | "indicators shared … banknifty with banknifty" | Indicator **definitions** replicate across same-symbol charts; each recomputes on its own TF. | **per-symbol sub-group** |
| **Time** | "click a time → the other chart goes to that anchor time & price" | Pointer **click** ts on one chart → **scroll that ts+price into frame** + place crosshair there on the others (does **not** change their window bounds). Click-only (no hover). | whole layout |
| **Date range** | "date range same on all charts" | Identical visible window `[from_ts,to_ts]` on every chart — **window, not zoom** (each keeps its own bar spacing/TF). | whole layout |

### 5.1 Symbol / 5.2 Interval
Layout-wide locks. `ChartManager.setSymbolAll` / `setPeriodAll`, fanned out. When Symbol-sync is **on**
there is one symbol → the per-symbol partition below has a single group. When **off** (your 2×2 with two
symbols), the partition has two groups.

### 5.3 Crosshair / Drawings / Indicators — three symbol-scoped flags (LOCKED)
Split into **three independent flags** (config-granular; a UI can group them behind one "Share analysis"
switch). All three are **partitioned by symbol** — the two NIFTY charts form one sub-group, the two BankNifty
charts another; nothing crosses symbols (different price scales / levels).
- **`crosshair`** — the pointer position replicates within a symbol sub-group as a linked cursor
  (`setCrosshair(ts, value)`: dashed vertical + horizontal overlay lines; cheap, ~60fps). Across *different*
  symbols, only **Time** (§5.4) moves charts.
- **`drawings`** — a trendline drawn on NIFTY 1m appears on NIFTY 5m. Because drawings are `{ts,value}`
  ([Point](../src/types.ts)), they're **timestamp-keyed** and translate across TFs for free — the same
  principle that makes cross-TF sync work. Wired via the existing `drawingCreated/Modified/Removed` events
  → replay onto sibling same-symbol charts via `draw/updateDrawing/removeDrawing` (echo-suppressed).
- **`indicators`** — replicate the **definition** (`addIndicator("EMA",[20,50])`), **not** computed values;
  each chart recomputes on its own TF (Tier-1 built-ins already do this). As built: add and remove
  are replicated through `ChartManager.addIndicator` / `removeIndicator`. Direct `chart.addIndicator`
  calls bypass the manager and are not synced.

> Why separate: you'll often want shared drawings but per-chart indicators (EMA20 on 1m vs EMA50 on 5m), or
> the reverse. Independent flags cost nothing to implement (each is its own event replay). Grouping is a UI
> concern, not a config one.

### 5.4 Time — pointer anchor, scroll-into-frame
When you **click** time `T` on one chart (click-only — hover rejected to avoid jitter), every other chart does
`scrollTo(T)` (+ `setCrosshair(T)`) so `T` is **brought into view** — without forcing their window bounds
to match. This is the "my 5m chart is behind, I click the 1m chart, both jump to that time+price" case.
Mapping `T` into each chart's own bucket (a 1m `T` → the 5m bucket containing it) needs no code: v9
resolves a timestamp to the nearest loaded bar. Note that `scrollTo` puts `T` at the chart's **right
edge**, not the centre.

### 5.5 Date range — identical window
`setVisibleRange(from,to)` fanned to all. Distinct from Time: Date-range forces the **same span** on every
chart; Time only *navigates* to a point. "Window, not zoom" (ARCHITECTURE §6) means a 1m and a 5m chart show
the same time span at different bar spacing.

### 5.6 Implementation: `SyncController` (✅ built)
[SyncController.ts](../src/SyncController.ts) subscribes each chart's `crosshairMove` / `visibleRangeChange` /
`click` / drawing events. It keeps **link groups** (whole layout) **and implicit per-symbol sub-groups**
(§5.3), and fans out with **echo-suppression**: a synchronous `applying` guard for drawings and crosshair,
and a per-chart guard held (try/finally) while a date-range replay runs, since v9 fires the range event synchronously. Drawings are **id-mapped** across charts, so a
move or delete on any copy reaches the others. `ChartManager` sets which dimensions are live via
`SyncConfig`; `symbol`/`interval`/`indicators` are its own command fan-outs, not SyncController events.

---

## 6. Components & public API

Four new modules in `src/`, plus finishing `SyncController`.

### 6.1 `SessionClock` (`src/session.ts`)
```ts
class SessionClock {
  constructor(spec?: SessionSpec);               // absent → 24h UTC floor (D-T5)
  bucketOf(ts: number, periodMs: number): number;   // session-anchored start (§4)
  closeOf(bucketStart: number, periodMs: number): number;
  isOpen(ts: number): boolean;
}
```

### 6.2 `MultiPeriodAggregator` (`src/aggregation.ts`) — generalizes `BarBuilder`
```ts
class MultiPeriodAggregator {
  constructor(periods: Period[], clock: SessionClock);
  seed1m(bars: Bar[]): void;                      // seat the 1m spine after backfill (§2 seam)
  pushTick(t: Tick): Map<Period, Bar>;            // forming bars (provisional, §3 ⊕ merge)
  push1mClose(bar: Bar): void;                    // authoritative 1m → refold affected buckets
  onClose(cb: (period: Period, bar: Bar) => void): void;  // reconciled (confirmed) bar
}
```

### 6.3 `SharedDatafeed` (`src/SharedDatafeed.ts`) — implements `Datafeed`
Wraps the host feed; **charts don't know it exists**. One upstream tick sub + one spine per symbol; dedups;
routes backfill straight through per-TF.
```ts
function createSharedDatafeed(base: Datafeed, opts?: {
  session?: (symbol: string) => SessionSpec | undefined;   // per-instrument sessions
  seedMs?: number;                                          // 1m history to seed the spine with (default 1 day)
}): Datafeed;   // getBars + getRange pass straight through; subscribe joins the symbol's hub
```
As built, each hub seeds the spine with 1m bars ending at `getRange().to` for a bounded feed, or now for a live
one, spanning `max(seedMs, the chart's period)` (best-effort). Then it opens one `base.subscribe(sym, "1m")`. The hub is torn down when its last chart unsubscribes.

### 6.4 `ChartManager` (`src/ChartManager.ts`)
```ts
interface ChartManagerOptions {
  datafeed: Datafeed;                 // wrapped in SharedDatafeed internally
  series?: SeriesSource; storage?: Storage;
  timezone?: string; theme?: Theme;
  sync?: SyncConfig;                  // merged over the default: symbol+interval OFF, all other flags ON
  session?: (symbol: string) => SessionSpec | undefined;   // forwarded to SharedDatafeed
}

interface SyncConfig {                // REPLACED the original {symbol,crosshair,range,timeframe}
  symbol?: boolean;
  interval?: boolean;                 // was `timeframe`
  crosshair?: boolean;                // cross price-line position, symbol-scoped (§5.3)
  drawings?: boolean;                 // replicate drawings, symbol-scoped (§5.3)
  indicators?: boolean;               // replicate indicator definitions, symbol-scoped (§5.3)
  time?: boolean;                     // click → scroll-into-frame (§5.4)
  dateRange?: boolean;                // identical window (§5.5, was `range`)
}

class ChartManager {                  // as built (src/ChartManager.ts)
  constructor(opts: ChartManagerOptions);
  addChart(el: HTMLElement, spec: { symbol: string; period: Period }): ChartController;
  removeChart(chart: ChartController): void;
  getCharts(): ChartController[];
  setSymbol(chart: ChartController, symbol: string): Promise<void>;   // respects `symbol` sync
  setPeriod(chart: ChartController, period: Period): Promise<void>;   // respects `interval` sync
  setSymbolAll(symbol: string): Promise<void>;
  setPeriodAll(period: Period): Promise<void>;
  addIndicator(chart: ChartController, name: BuiltinIndicator, paneId?: PaneId, params?: number[]): IndicatorId;
  removeIndicator(chart: ChartController, id: IndicatorId): void;
  setSync(cfg: Partial<SyncConfig>): void;
  getSync(): SyncConfig;
  serializeLayout(): GridSnapshot;                       // per-cell { symbol, period, LayoutSnapshot } (no sync cfg)
  restoreLayout(snap: GridSnapshot): Promise<void>;      // by index onto EXISTING cells
  disposeAll(): void;
}
```
There is **no `layout()` method**. Grid geometry (presets, CSS grid) is host-side; the demo implements it in
[grid.ts](../demo/src/grid.ts) on top of `addChart`/`disposeAll` (§6.5).

Your 2×2:
```ts
const mgr = new ChartManager({ datafeed: qpFeed,
  sync: { crosshair: true, drawings: true, indicators: true, time: true, dateRange: true } });
mgr.addChart(elA, { symbol: "NIFTY",     period: "1m" });
mgr.addChart(elB, { symbol: "NIFTY",     period: "5m" });
mgr.addChart(elC, { symbol: "BANKNIFTY", period: "1m" });
mgr.addChart(elD, { symbol: "BANKNIFTY", period: "5m" });
// 2 upstream tick subs; 5m derived from 1m; drawings/indicators shared within each symbol;
// click-to-time + identical date-range across all four.
```

### 6.5 Layout catalog (grid presets) — host/demo side
The presets live in the **demo** ([grid.ts](../demo/src/grid.ts) `PRESETS` / `applyLayout`), not in the
library (D-CM6: templates over free `addChart`). They mirror TradingView's picker: uniform grids plus
a few asymmetric splits (CSS `grid-template-areas`). The demo ships these 12:

| id | arrangement | charts | id | arrangement | charts |
|---|---|---|---|---|---|
| `1` | 1×1 | 1 | `2x2` | 2×2 | 4 |
| `2h` | two side-by-side | 2 | `1L2R` | 1 left + 2 stacked right | 3 |
| `2v` | two stacked | 2 | `1T3B` | 1 top + 3 across | 4 |
| `3h` | three columns | 3 | `3x2` | 3 cols × 2 rows | 6 |
| `4h` | four columns | 4 | `2x3` | 2 cols × 3 rows | 6 |
| — | — | — | `4x2` | 4 cols × 2 rows | 8 |
| — | — | — | `3x3` | 3×3 | 9 |

(`3v` and `4v` from the original plan were not built.)

As built, **relayout rebuilds every cell**: `applyLayout` calls `manager.disposeAll()` and re-adds the
charts. Each cell's symbol/period is remembered, but **drawings and indicators are lost** on a layout
change (preserving surviving cells is a polish item). Each cell has its own mini-toolbar (symbol picker +
free-text interval, e.g. `17m`). The **active cell** (click to focus) receives toolbar drawings and the EMA
button, then sync fans them out.

> **Demo status:** ✅ live in `demo/grid.html` (`npm run demo:grid`) against the Mock feed, including the
> 7-toggle sync panel and shared-feed dedup.

---

## 7. What the backend must provide

Very little: ~90% of the grid is client-side. A host needs per-timeframe backfill (`getBars`), one live
stream per symbol (`subscribe`), and 1m OHLCV for reconciliation (D-CM2). A live stream of closed 1m bars is
an optional upgrade that makes the reconciled live edge fully authoritative. What QuantPrime already
provides, and the Zerodha tick-feed facts behind D-CM2, are in
[integrations/quantprime.md](integrations/quantprime.md#what-the-multi-chart-grid-needs-from-the-backend).

---

## 8. Build order

1. ✅ **`SessionClock` + `periodToMs`** ([src/session.ts](../src/session.ts)) — arbitrary integer periods
   (`10m`/`17m`/…) + session-anchored bucketing; `BarBuilder` now delegates to `periodToMs`. 9 unit tests
   ([session.test.ts](../src/__tests__/session.test.ts)); typecheck+build green.
2. ✅ **`MultiPeriodAggregator`** ([src/aggregation.ts](../src/aggregation.ts)) — hybrid fold (provisional
   tick edge) + confirmed 1m closes + `push1mClose` reconciliation (signature-dedup re-emit), session-
   anchored. 5 tests ([aggregation.test.ts](../src/__tests__/aggregation.test.ts)); typecheck+build green.
3. ✅ **`SyncController`** ([src/SyncController.ts](../src/SyncController.ts)) — crosshair/drawings/time/
   dateRange, per-symbol partition, echo-suppression; `setCrosshair` implemented as an overlay linked-cursor
   (v9 has no native setter); `periodMs` arbitrary-period bug fixed. 6 tests.
4. ✅ **`SharedDatafeed`** ([src/SharedDatafeed.ts](../src/SharedDatafeed.ts)) — one upstream sub per symbol,
   1m spine seed + derive-from-base fan-out, teardown on last unsub. 3 tests.
5. ✅ **`ChartManager`** ([src/ChartManager.ts](../src/ChartManager.ts)) — grid lifecycle; symbol/interval/
   indicators command fan-out; `setSync`; `serializeLayout`/`restoreLayout`.
6. ✅ **Demo** — 2×2 in [grid.html](../demo/grid.html)/[grid.ts](../demo/src/grid.ts): 12 layout presets, live
   7-toggle sync panel, per-cell custom-interval combobox (17m), draw toolbar + EMA on the active chart.
   Verified headless: 4 charts render, relayout works, **0 console errors**.

Tests at the time: **46 green** (was 20); typecheck + build clean. Coverage: aggregator (17m off 09:15;
reconcile; short last bucket; pushForming1m); SessionClock (multi-session, gap, absent-spec); SyncController
(echo-suppression, per-symbol partition, id-mapped drawings); SharedDatafeed (one upstream sub for N
same-symbol charts). The whole suite is now 79 (see [PROGRESS.md](PROGRESS.md)).

**Known limitations / next polish:**
- Date-range sync is *reactive* (drag one → others follow); it doesn't force-align on load or when switched on.
- Relayout rebuilds every cell, so drawings and indicators are lost (§6.5).
- No drag-to-resize splitters, no chart maximize.
- Whole-grid persistence: `serializeLayout` exists, but the UI isn't wired.
- No per-instrument session calendars (the mock demo is 24h/UTC).
- No single-connection multiplexed host adapter (§2).
