# TickLine — Architecture (v1)

## Summary

- **What:** the design of TickLine, a TypeScript charting library on KLineChart v9: a `ChartController` that a host app drives, three adapter interfaces the host implements, the indicator model, drawings, multi-chart sync and the error contract.
- **Where it sits:** between a host app (its backend, DB and sockets) and KLineChart. Everything host-specific comes in through the adapters.
- **Rules it must not break:** bars are always UTC ms; the library never depends on one consumer or one market; adapters never throw synchronously.
- **Status:** v1 core built (single chart, built-in indicators, drawings, sync, multi-chart grid, backtest toolkit). Tier-2 `plotSeries` is the main open item. Detail: [PROGRESS.md](PROGRESS.md).

> The decisions behind this design (D-T1–T5, R-T1–T4, D-CM1–6) are in [DECISIONS.md](DECISIONS.md). How QuantPrime plugs in is in [integrations/quantprime.md](integrations/quantprime.md). The original multi-language spike is in [archive/](archive/).

## 1. What TickLine is

A standalone TypeScript charting library on **KLineChart v9**. It ships:
- a **`ChartController`** — the imperative API a host app drives, and
- **three adapter interfaces** the host implements to feed data, indicator series, and persistence.

TickLine owns rendering, drawing tools, overlays, and multi-chart sync. It owns **none** of the
host's infrastructure (backend, DB, WS) — those arrive through adapters.

**Why a standalone library (not a QuantPrime component):** TickLine is **released publicly** as a
reusable charting library. QuantPrime is its first consumer; the clean adapter boundary exists so any
other app can consume it. This is the deliberate reason it is *not* folded into `QuantPrime/frontend`.

## 2. The three seams (adapter interfaces)

Because TickLine is shippable, it cannot hardwire to QuantPrime's `/history`, SQLite, or Python.
Everything host-specific enters through three interfaces. This is the KLineChart-Pro Datafeed
pattern ([archive/chart_library_analysis.md](archive/chart_library_analysis.md)) generalized to three concerns.

```
interface Datafeed {                    // BARS — always delivers bars, never raw ticks
  getBars(symbol, period, from, to): Promise<Bar[]>          // backfill / scroll-back
  subscribe(symbol, period, onBar): Unsub                    // live: pushes updating + closed bars
  getRange?(symbol, period): {from, to} | null               // optional: bounded (historical/replay) feeds, §7.1
}
interface SeriesSource {                // INDICATORS (host-computed, e.g. a Python engine)
  request(spec): Promise<SeriesResponse>                     // { meta, points: {ts, value, confirmed}[] }
  stream?(spec, onPoint: (p: SeriesPoint) => void): Unsub    // live updates as bars form
}
interface Storage {                     // PERSISTENCE (layout + drawings)
  load(key): Promise<Json|null>
  save(key, json): Promise<void>
}
```

**What each adapter is for:**
- `Datafeed` delivers **bars**. If the host's live source is a tick stream, the adapter aggregates tick→bar (TickLine's optional `BarBuilder` helps) and hands TickLine finished or updating bars. Market and session rules stay in the adapter, which keeps TickLine market-agnostic. If the backend takes a day count instead of a range, the adapter converts (R-T3).
- `SeriesSource` returns host-computed series as `{meta, points: {ts, value, confirmed}[]}`. **Tier 2 only (D-T4)**: built-in indicators need no adapter. Not built yet.
- `Storage` is key/value JSON. TickLine serializes overlays and layout (`serialize()`) and the **consumer** calls `save`/`load`; TickLine never touches the store or calls `Storage` itself.
- `SessionSpec` (optional, D-T5) describes trading hours per instrument: `{ tz, days, sessions: [{start, end}] }`. Absent means 24h-continuous. It drives session-anchored derivation in `ChartManager` (via `SessionClock`) and in `BarBuilder` when passed one. A single chart's `ChartOptions.session` is accepted but unused.

The QuantPrime adapters (its `/history` and `/ws/ticks` endpoints, symbol→token mapping, NSE session) are described in [integrations/quantprime.md](integrations/quantprime.md).

> **Bars, not ticks — and `subscribe` vs `updateData`:** the `Datafeed` boundary is always *bars*.
> Tick→bar aggregation is the **adapter's** job; TickLine ships an optional **`BarBuilder`** helper for
> consumers whose source is a raw tick/trade stream (opt-in — bar-native sources ignore it).
> `subscribe(onBar)` is the **live path** (TickLine applies each bar to the chart); `updateData()` is a
> **manual escape hatch** for imperative/replay pushes without a subscription.

## 3. ChartController API (what the host calls)

```
LIFECYCLE   createChart(el, opts) · dispose() · resize() · setLoading(state)
DATA        setData(bars) · updateData(bar) · prependData(bars) · clearData()
            setSymbol(sym) · setPeriod(tf) · refresh() · jumpTo(ts)
            → emits: needHistory(symbol, period, before)     // informational; backfill is automatic
PANES       createPane(opts) → paneId · removePane(paneId) · resizePane(paneId, height)
            movePaneSeries(seriesId, paneId) 🔲 · getPanes()
INDICATORS  addIndicator(name, paneId?, params?) → indId · removeIndicator(indId) · listIndicators()  // Tier 1: built-ins (createIndicator)
SERIES      plotSeries(paneId, points, meta) · updateSeries(id, point) · removeSeries(id)  🔲     // Tier 2: host-computed / MTF / custom
DRAW        draw(tool, points, style) · updateDrawing(id, points) · removeDrawing(id) · clearDrawings()
            serialize() → json · restore(json)
            → emits: drawingCreated / drawingModified / drawingRemoved  {id, tool, points}
TRADE       priceLine(id, price, style) · removePriceLine(id)
            setMarkers(marks) · setPositions(ps) · setLevels(ls) · clearTradeAnnotations()
VIEW/SYNC   setVisibleRange(from_ts, to_ts) · scrollTo(ts) · zoomTo(ts) · setCrosshair(ts, value?) · clearCrosshair()
            getVisibleRange() · setTimezone(tz) · setTheme(theme)
            screenshot() · setPrecision(p)                          // (v1.5)
            → emits: crosshairMove(ts,val) · visibleRangeChange(from_ts,to_ts) · click · error
GROUPS      linkGroup(id) · syncConfig({ symbol, interval, crosshair, drawings, indicators, time, dateRange })
            // live only when a SyncController is attached — ChartManager does this (§6)
```

> **v1 vs v1.5 surface ([R-T4](DECISIONS.md#api-questions-resolved-before-the-build-r-t)).** v1 = everything in the block above **except** the line
> tagged `(v1.5)` (`screenshot`, `setPrecision`; runtime precision today = `ChartOptions.precision`).
> 🔲 = in v1 scope but not built yet (calling one emits a `series` error and does nothing). `setTimezone` and `setTheme` are **v1**.
> Built-in drawing tools only in v1 (trend/ray/h-line/v-line/rect/fib/text); the ~60 custom tool families
> are v1.5 (D-T2). `BarBuilder` ships in v1 core (referenced by the datafeed example, §2).

> **Engine mapping:** every method above is mapped to a real KLineChart v9 (`9.8.12`) call in
> [KLINECHART_MAPPING.md](KLINECHART_MAPPING.md). Note `needHistory` uses `setLoadDataCallback`
> (**not** the deprecated `loadMore`); `setVisibleRange`/`setCrosshair`/`priceLine`/`setMarkers`/pane
> lifecycle are **build-on-primitive** (no native v9 API) — see that doc's "real build work" summary.

> **Trade primitives are TickLine wrapper APIs**, not native KLineChart calls. `priceLine` wraps v9's native
> `priceLine` overlay. Markers, position boxes and levels are custom overlays (`tlMarker`, `tlPosition`,
> `tlLevel`) managed by `TradeLayer` (§7.1).

> **Pane lifecycle (why it exists):** pane creation/destruction/sizing is the consumer's explicit job
> for **Tier-2** (`plotSeries`) series — built-in indicators (Tier 1) manage their own pane via
> KLineChart. The **main/candle pane** always exists (`paneId = "main"`); overlay indicators
> (EMA/BOLL/VWAP) render onto it. **Sub-indicators** (RSI/MACD/VOL) need their own pane:
> `createPane({ height, position })` → `paneId`, then `addIndicator`/`plotSeries` into it. Because v9 has no
> standalone pane API, the pane only materializes when its first indicator is added. Removing the last
> indicator from a sub-pane **auto-removes the pane** unless it was created `sticky: true`; the main pane is
> never removed. `resizePane` handles layout edits (`movePaneSeries` arrives with Tier 2).

## 4. Indicator model — `plotSeries` + MTF contract

Indicators come in **two tiers** (D-T4):

**Tier 1 — built-ins (in-library, the common case).** Standard indicators — EMA/MA, MACD, RSI, VOL,
BOLL, KDJ, and the rest of KLineChart's registered set — are thin wrappers over KLineChart's
**client-side `createIndicator`**. No backend, no adapter: `addIndicator("EMA", paneId, params)` and the
engine computes + renders (legend, tooltip, settings for free).

**Tier 2 — `plotSeries` + `SeriesSource` (host-computed).** Reserved for the cases a client-side
built-in *cannot* serve — the boundary is **capability, not complexity**:
- **MTF** — a 15m EMA on a 1m chart. A built-in computes on the loaded base-TF bars only; it can't hold
  a higher-TF value across base bars. The forward-fill / `confirmed` contract below needs `SeriesSource`.
- **Strategy parity** — if a strategy traded on `ta.ema(20)` computed in Python, the chart must plot
  *that* series, not KLineChart's separately-computed one (warm-up/rounding differ → they won't match,
  which misleads in a trading terminal).
- **Backtest look-ahead safety** — built-ins repaint the forming bar; `confirmed`-only display needs Tier 2.
- **Genuinely custom** indicators the host computes itself (for example in a Python strategy engine).

> **Build status:** Tier 2 is not built. `plotSeries`/`updateSeries`/`removeSeries` emit a `series` error and
> do nothing (`plotSeries` returns `""`). The contract below is the locked design for when it lands. A host
> needs a series endpoint to use it; QuantPrime's status is in [integrations/quantprime.md](integrations/quantprime.md).

The `SeriesSource` must honour:
1. **Forward-filled dense, aligned to the base axis.** The `SeriesSource` emits one value **per base
   bar** (not one per higher-TF bar): the higher-TF value is *held* across each base bar until the next
   higher-TF close. So a 15m series on a 1m chart carries a value at **every 1m timestamp** (the last
   closed 15m value), producing a clean staircase without relying on chart-side gap-filling. No
   separate 15m axis. (Sparse-emit + chart-side stepping was rejected — KLineChart won't step-hold a
   sparse overlay series across missing bars for free.)
2. **`confirmed` vs `provisional` per point** — the MTF **repaint / look-ahead guard**. The
   still-forming higher-TF bar shows the last *closed* value (confirmed) unless the host explicitly
   opts into live/provisional. Backtests must use confirmed-only.
3. **`meta` = `{ label, color?, precision?, type?, group? }`** (per-series, NOT per-point — R-T1) — so the chart renders legend + crosshair tooltip (the one UX win `createIndicator` gave for free). MACD = 3 series sharing a `group`. Pane placement is passed to `plotSeries(paneId, …)`, not duplicated in `meta`.
4. **Recompute triggers:** `setPeriod` (new base TF) and scroll-back (extended range) re-request all
   active series over the new range.
5. **Live bar↔series coordination (the desync rule).** The live **bar** stream (`Datafeed.subscribe`)
   and the live **series** stream (`SeriesSource.stream`) are independent async sources, so a bar can
   render before its indicator value arrives. The rule: **every series point is keyed to its bar
   timestamp, and `updateSeries` is an idempotent upsert-by-timestamp**. Consequences:
   TickLine **never blocks bar rendering** waiting for an indicator — the series simply patches the
   point at timestamp `T` when it arrives; a dropped provisional frame **self-heals** on the next
   update; and a closed bar's *confirmed* value overwrites the last provisional at the same `T`. So the
   chart tolerates "indicator may lag its bar by up to one frame," and is never left permanently stale.

## 5. Drawing / overlay framework (the ~68 tools)

Reimplement on KLineChart v9 `registerOverlay`. **Build the framework once**, then batch tools by family.

- **Framework:** a repeatable overlay pattern = `figures` + coordinate math (`convert*Pixel`) +
  hit-test + serialize. Every tool is data-in-points, engine-draws-figures.
- **Families:** lines · rays/channels · fibs (retracement/extension/time/fan) · Gann (fan/box/square)
  · shapes · text/annotations · forecasting · position tools (long/short/size) · **volume profile**
  (build as a custom **indicator/figure**, not an overlay).
- **License hygiene (D-T1 is shippable):** reimplement geometry *from the repos as spec* → clean.
  Never copy **difurious (MPL-2.0)** source into MIT files.
- **Persistence:** `serialize()` = full **layout snapshot** → JSON, keyed `(symbol, timeframe, layout)`
  by the consumer, saved via `Storage`; `restore()` rehydrates it. Snapshot shape (R-T2):
  `{ version, drawings, panes, seriesSpecs, viewRange }`. **Series *data* is never serialized** — only
  the `SeriesSpec` is; on `restore()`, TickLine will re-request data via `SeriesSource.request(spec)` so
  stale cached values can't leak into a chart (Tier 2; `seriesSpecs` is `[]` until then). Drawings are
  captured from TickLine's **own overlay registry**, because v9 has no bulk overlay export.
- **As built (v1):** the custom overlays are `rect` (2-point box), plus the trade annotations `tlMarker`,
  `tlPosition`, `tlLevel` ([src/overlays.ts](../src/overlays.ts)). The generic multi-family framework
  (hit-test, per-tool serialize) arrives with the v1.5 tools.
- **Volume-profile caveat:** safaritrader's known perf bug on large datasets — bin server-side or
  throttle; don't recompute per frame.

## 6. Multi-chart sync

**TickLine owns** a **`SyncController`** that holds all chart instances + link-group membership and
speaks only the ChartController events/commands above. Multi-chart orchestration lives **entirely in
TickLine** (independent of any consumer). As built, the host uses **`ChartManager`**
([CHARTMANAGER.md](CHARTMANAGER.md)), which attaches the SyncController and links every chart it creates.
`linkGroup` on a bare chart does nothing. It runs browser/JS-side, so interaction sync never
round-trips to a backend.

- **Split by frequency:** interaction (crosshair/zoom/pan) syncs **chart→chart inside TickLine at
  ~60fps**, never round-tripping to a backend; config (symbol/TF/indicator/drawing) is low-freq and
  consumer-driven.
- **Timestamp-keyed, not bar-index** — the only way cross-TF (1m/5m/15m) sync works ([archive/chart_library_analysis.md](archive/chart_library_analysis.md)).
- **Window, not zoom** — sync `(from_ts, to_ts)`; each chart fits its own bar spacing.
- **Echo-suppressed** — receiving charts don't re-emit while a programmatic sync is applied.
- **Independent flags (D-CM4, supersedes the original `{symbol, crosshair, range, timeframe}`):**
  `symbol`, `interval` (whole layout, default off) · `crosshair`, `drawings`, `indicators`
  (**same-symbol charts only**, default on) · `time` (click → scroll into frame), `dateRange` (identical
  window) (whole layout, default on). `symbol`/`interval`/`indicators` are ChartManager command fan-outs;
  the rest are SyncController event replays.
- **Data ≠ sync** — N charts on one symbol = one upstream `subscribe` fanned out. That is the
  datafeed layer's job (TickLine's `SharedDatafeed`, D-CM5), not the SyncController's.

## 7. Build order

**v1 — usable chart:**
1. **`ChartController` skeleton + `Datafeed` adapter** — bars render, live update, scroll-back backfill.
2. **Tier-1 built-in indicators** (`addIndicator`/`removeIndicator` over KLineChart's `createIndicator`)
   — EMA/MACD/RSI/VOL working with **zero backend**. Then **Tier-2 `plotSeries` + `SeriesSource`** (MTF
   contract) once a host `/series` endpoint exists — deferrable, since Tier 1 covers the common case.
3. **Basic tools (built-ins) + overlay framework** — expose KLineChart's ~6-8 built-in tools
   (trend/ray/h-line/fib/text; `rect` needed a custom overlay) and stand up the reusable overlay
   framework (figures + coords + hit-test + serialize) that v1.5 tools will plug into; `serialize`/`restore` via `Storage`.
4. **`SyncController` + link groups** + trade primitives (`priceLine`/`setMarkers`).

**v1.5 — parity + polish:**
5. **Remaining ~60 custom tool families** on the v1 framework (lines/channels, fibs, Gann, shapes,
   forecasting, position tools, **volume profile**) + theming/timezone/screenshot.

**Status (2026-10-04):** steps 1, 3 and 4 are done, and step 2 is done for Tier 1 (Tier-2 `plotSeries` is
still open). The multi-chart grid ([CHARTMANAGER.md](CHARTMANAGER.md)) and a **backtest toolkit** (§7.1)
have also landed. Details are in [PROGRESS.md](PROGRESS.md).

### 7.1 Backtest toolkit (added for the QuantPrime strategy POC)

This path lets a Python backtest render in TickLine. It adds no new seams; everything rides the existing
`Datafeed` interface plus the overlay engine.

- **Bounded feeds.** The optional `Datafeed.getRange?` gives the chart the span of the data. `StaticDatafeed`
  (in-memory, 7-day windows) and `ReplayDatafeed` (clipped at the cursor; `play/step/seek`) implement it.
- **Trade annotations.** `setMarkers` / `setPositions` / `setLevels` go through `TradeLayer`, which only
  draws annotations whose bars are loaded. That one rule gives chunked loading and replay.
- **`BacktestView`** is the shared viewer (chart + replay transport + trade navigation).
- **Delivery.** `dist/standalone` (IIFE, global `TickLine`), and `python/tickline_widget` (anywidget), whose
  bundled `widget.js` mounts `BacktestView`. Bars cross as packed float64.

## 8. Open risks

- **~60 custom tools is the dominant cost — now deferred to v1.5** (D-T2). v1 rides KLineChart's
  built-ins, so this no longer blocks a usable chart. Framework-first, then batch; expect the long
  tail (forecasting, exotic Gann) to be low-usage grind.
- **v9 is frozen** (D-T3) — no upstream fixes; you own any overlay-engine edge cases.
- **Volume profile perf** (§5) on large datasets.

## 9. Resolved decisions

R-T1 (series `meta` is per series), R-T2 (`serialize()` is a full layout snapshot), R-T3 (backfill is always a range) and R-T4 (v1 vs v1.5 methods) are in [DECISIONS.md](DECISIONS.md#api-questions-resolved-before-the-build-r-t).

## 10. Error contract (locked for v1)

Adapter failures and internal failures surface through one channel — **never thrown synchronously
out of an adapter**, and never swallowed silently.

```
// every error emits on the "error" channel AND flips setLoading("error")
interface TickLineError {
  kind:    "datafeed" | "series" | "storage" | "internal";
  op:      string;            // e.g. "getBars", "subscribe", "request", "plotSeries"
  message: string;            // human-readable
  cause?:  unknown;           // original adapter error, for logging
  retryable: boolean;         // transient (network/timeout) vs fatal (bad symbol/contract)
}
```

Rules:
1. **Adapters must not throw synchronously.** `getBars`/`request`/`save` return rejected
   `Promise<TickLineError>`; `subscribe`/`stream` callbacks may receive an error arg or signal via
   the host's `on("error")` — pick the rejected-promise path for one-shot ops, the event path for
   stream drops.
2. **TickLine never retries.** Retries are the consumer's job (it owns auth/backoff/rate-limits). A
   `retryable` flag tells the consumer whether to bother.
3. **Visual state:** any error flips `setLoading("error")` so the host's overlay can render a
   message; a successful subsequent op flips it back to `"ready"`.
4. **Partial-failure handling:** a `getBars` rejection during scroll-back leaves existing bars on
   screen and emits the error — it does **not** clear the chart. A `subscribe` stream drop keeps the
   last good bar and emits `retryable: true`; the consumer decides whether to resubscribe.
5. **`setLoading("error")` does not throw** — it is a state transition; the host reads it.

> **As built (2026-10-04):** two kinds are emitted. `datafeed`, with ops `"setSymbol/setPeriod"`,
> `"getBars(backfill)"` and `"getBars(forward)"`, always `retryable: true`; and `series`, from the unbuilt
> Tier-2 methods, with `retryable: false`. Rule 3's flip back to `"ready"` happens on the next successful
> `setSymbol`/`setPeriod`/`refresh` (not after a successful backfill). Rule 4's stream-drop detection is
> **not** implemented: TickLine can't observe a dead `subscribe`, so the adapter must detect it. The
> `storage` kind arrives with built-in persistence.

> **Validation rule (consumer-side):** if your `Datafeed` throws synchronously, that's a bug in your
> adapter, not a TickLine failure. Wrap third-party SDKs that throw (e.g. a raw WebSocket constructor)
> in `try/catch` and convert to a rejected promise or an `on("error")` emit.
