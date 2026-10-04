# TickLine → KLineChart v9 (`9.8.12`) API Mapping

> **Build spec.** Every `ChartController` method (API.md §4) mapped to a real KLineChart v9 call,
> verified against the installed `klinecharts/dist/index.d.ts` (the copy QuantPrime already ships).
> Status legend:
> - **native** — a 1:1 v9 call exists; wrapper is a thin pass-through.
> - **build-overlay** — no native API; implement on `createOverlay` / `registerOverlay`.
> - **build-indicator** — implement on `createIndicator` / `registerIndicator`.
> - **build-compose** — no single call; compose from v9 primitives.
> - **build-callback** — driven by a v9 callback/lifecycle, not an imperative call.

## Global / factory

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `createChart(el, opts)` | `init(el, options)` → `Chart` | native | `opts.timezone`→`options.timezone` (default `"UTC"`), `opts.theme`→`resolveTheme()`→`options.styles` (+ container background), `opts.locale`→`options.locale`. After init: `opts.precision`→`setPriceVolumePrecision(p, p)`, `opts.autoResize`→`ResizeObserver`→`resize()`. |
| `dispose()` | `dispose(el \| chart)` | native | |
| `resize()` | `chart.resize()` | native | |
| register custom tool | `registerOverlay(template)` | native | v1.5 tool families. |
| register Tier-2 series | `registerIndicator(template)` | native | see `plotSeries` below. |

## Lifecycle & data

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `setData(bars)` | `applyNewData(dataList, more?)` | native | map `Bar`→`KLineData` (`ts`→`timestamp`). |
| `updateData(bar)` | `updateData(data)` | native | v9 only **appends** (`ts` > last) or **replaces the last** bar (`ts` == last). Anything older is silently ignored. |
| `prependData(bars)` | (per-bar `updateData`) | ⚠ **limitation** | Implemented as per-bar `updateData`, so given v9's rule above, **older bars are dropped**. Real backfill goes through `setLoadDataCallback` Forward (below), which is the correct path. A working imperative prepend would need the deprecated `applyMoreData` or a full `applyNewData` re-apply. |
| `clearData()` | `clearData()` | native | |
| `setSymbol` / `setPeriod` | — | build-compose | TickLine-level: unsubscribe → `getBars(initial window: 7 days or 500 bars, whichever is longer, ≤20 000 bars)` → `applyNewData(bars, olderMore)` (Init clears) → `subscribe` → `updateData`. A `loadSeq` guard drops stale reloads. (Tier-2 series re-request arrives with Tier 2.) |
| `setLoading(state)` | — | build | TickLine renders its own overlay div; v9 has no loading state. |
| **emits** `needHistory` | `setLoadDataCallback(cb)` w/ `LoadDataType.Backward` | **native (⚠ not `loadMore`)** | `loadMore` is **deprecated since 9.8.0**. Use `setLoadDataCallback` — `params.type ∈ {Init, Forward, Backward}`. **Corrected (engine source):** `Forward` = PREPEND older bars (scroll-left backfill, fires when `from===0`); `Backward` = APPEND newer bars (fires when `to===totalBarCount`, **including right after `applyNewData`**). Reply via `params.callback(bars, more)`. ⚠ v9 keeps the view's offset from the right edge, so a Backward append jumps the view to the new end. TickLine compensates with `scrollByDistance(n × barSpace)` and declines the re-entrant fire. |
| `jumpTo(ts)` / `refresh()` | `applyNewData` + `scrollToDataIndex` | build-compose | `scrollToTimestamp` puts the bar at the **right edge**, so TickLine centres it via `scrollToDataIndex(idx + halfScreen)`. Backward loads are held while the view is positioned. |
| Datafeed `getRange?` | — | TickLine | Bounded feeds open at their end (not `Date.now()`) and page newer bars on Backward. Live feeds omit it (Backward → empty). |

## Indicators (Tier 1) & series (Tier 2)

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `addIndicator(name, paneId?, params?)` | `createIndicator({name, calcParams}, isStack?, {id:paneId})` | native | Tier 1. Built-ins listed below. |
| `removeIndicator(id)` | `removeIndicator(paneId, name?)` | native | v9 keys by `(paneId, name)`, not a single id — wrapper keeps an id→(pane,name) map. |
| `listIndicators()` | — (wrapper registry) | build | Read from TickLine's own `id → {paneId, name}` map, not from `getIndicatorByPaneId()`. |
| `plotSeries(paneId, points, meta)` | `registerIndicator(customTemplate)` + `createIndicator` | **🔲 build-indicator (not built)** | Tier 2. Implement an "external series" indicator whose `calc` just returns the host-supplied values (`meta`→figures/tooltip). This is how a host-computed series gets a pane + legend for free. Today it emits a `series` error and returns `""`. |
| `updateSeries(id, point)` | `overrideIndicator` / re-`applyNewData` | 🔲 build-indicator (not built) | idempotent upsert by ts; patch the external-series indicator's data. Emits a `series` error today. |
| `removeSeries(id)` | `removeIndicator(paneId, name)` | 🔲 (not built) | Emits a `series` error today; trivial once `plotSeries` exists. |

## Panes

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `createPane(opts)` | — | **build-compose** ✅ | v9 has **no standalone `createPane`**: panes exist only as a side-effect of `createIndicator(..., {id})`. The wrapper reserves the id (+ height/sticky) and the pane materializes on the first `addIndicator` into it, which then applies the recorded height. |
| `removePane(id)` | `removeIndicator(paneId, name)` per indicator | build-compose ✅ | removing all indicators in a pane removes it; main pane protected. |
| `resizePane(id, h)` | `setPaneOptions({id, height})` | native ✅ | height recorded; applied immediately only if the pane is live. |
| `movePaneSeries` | — | 🔲 build-compose (not built) | remove+re-add on target pane; waits on Tier 2. Emits a `series` error today. |
| `getPanes()` | — (wrapper registry) | build ✅ | live panes from the wrapper's registry. `height` = last recorded height (0 if never set), **not** a `getSize()` measurement. |

## Drawings

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `draw(tool, points?, style?)` | `createOverlay({name, points, …handlers})` | native | friendly-name→v9-overlay map (see below). Omit `points`→interactive (v9 enters draw mode). **TickLine `Point={ts,value}` ↔ v9 `{timestamp,value}`** conversion in `toV9Points`/`fromV9Points`. Lifecycle handlers attached per overlay. |
| `updateDrawing(id, points)` | `overrideOverlay({id, points})` | native | also emits `drawingModified`. |
| `removeDrawing(id)` | `removeOverlay(id)` | native | fires the overlay's `onRemoved` → `drawingRemoved` (+ registry delete). |
| `clearDrawings()` | `removeOverlay()` (no arg) | native | Removes **every** overlay (drawings, linked cursor, trade annotations) and emits `drawingRemoved` per known drawing. `TradeLayer.invalidate()` then re-creates the trade annotations. |
| `serialize()` | wrapper overlay registry → `LayoutSnapshot` | ✅ done | v9 has no bulk export; the wrapper walks its own `overlays` Map (B4). |
| `restore(json)` | `createTracked(...)` per drawing | ✅ done | **silent** — does NOT emit `drawingCreated` (bulk rehydrate). |
| **emits** `drawingCreated/Modified/Removed` | `onDrawEnd` / `onPressedMoveEnd` / `onRemoved` on `OverlayCreate` | ✅ done | not on the action bus — per-overlay callbacks set in `draw()` and re-emitted as TickLine events. Programmatic draws (points given) emit `drawingCreated` immediately; interactive draws emit on `onDrawEnd`. |

## Trade primitives

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `priceLine(id, price, style)` | `createOverlay` (`priceLine` overlay w/ axis label) | **native** | v9 **does** ship a `priceLine` overlay (verified). Wrapper upserts by id (`removeOverlay(id)` then create); native overlay auto-renders the price as the y-axis label. Only `style.color`/`width` are applied; `label`/`dash`/`axisLabel` are ignored. A custom text label ("Entry"/"SL") needs a custom overlay (v1.5). |
| `removePriceLine(id)` | `removeOverlay(id)` | native | |
| `setMarkers(marks)` | `registerOverlay("tlMarker")` + `createOverlay` per marker | **✅ built** | No native markers. Custom overlay draws `polygon`/`circle`/`rect` + `text` figures offset from the anchor (bar high/low). |
| `setPositions(ps)` | `registerOverlay("tlPosition")` | **✅ built** | Points `[entry, end@TP, end@SL, exit?]` → 2 `rect` zones + entry `line` + dashed exit `line` + R chip (`text` with `backgroundColor`). |
| `setLevels(ls)` | `registerOverlay("tlLevel")` | **✅ built** | 2-point horizontal `line` + label. |

**Annotation visibility rule (TradeLayer).** v9 resolves an overlay point's timestamp to the **nearest
loaded bar** (`binarySearchNearest` on every redraw). So an annotation whose bar isn't loaded would be drawn
clamped to the data edge. `src/tradeLayer.ts` therefore creates each annotation only while its bar is
loaded, and re-checks after every data change. That rule makes chunked loading and replay work with no
extra code. All annotations share `groupId "__tickline_trade"` and `lock: true`.

## View & sync

| TickLine | v9 | Status | Notes |
|---|---|---|---|
| `scrollTo(ts)` | `scrollToTimestamp(ts)` | native | Puts the bar at the **right edge** (`scrollToDataIndex` math). Also `scrollToRealTime()`. Centring is `jumpTo`. |
| `zoomTo(ts, factor?)` | `zoomAtTimestamp(scale, ts)` | native | |
| `getVisibleRange()` | `getVisibleRange()` | build ✅ | v9 returns **bar indices**, not timestamps. TickLine converts them to ms here, in the `visibleRangeChange` event and in `serialize().viewRange`. |
| `setVisibleRange(from, to)` | — | **build-compose** ✅ | **No native window setter.** `setBarSpace(width / loaded bars in [from,to])` + `scrollToDataIndex(index of to)`, which pins `to` at the right edge. Counting loaded bars keeps session gaps from squashing candles. If the window isn't loaded: a wall-clock estimate + `scrollToTimestamp(to)`. Used by SyncController date-range sync. |
| `setCrosshair(ts)` | overlays (`verticalStraightLine` + `horizontalStraightLine`) | **✅ built** | No programmatic crosshair setter in v9; implemented as a locked linked-cursor overlay pair (upsert via `overrideOverlay`). |
| `setTimezone(tz)` | `setTimezone(tz)` | native | **promoted to v1** (D-T5). |
| `setTheme(theme)` | `init({styles})` / `setStyles(styles)` | **✅ built** | v9 *does* register `"dark"`/`"light"`, but `"dark"` only recolours grid/axes and the canvas stays transparent. TickLine passes its own full palettes (same keys in both, because v9 **merges** styles and never resets) and paints the container background (`src/theme.ts`). |
| `setPrecision(p)` | `setPriceVolumePrecision(price, vol)` | native | v1.5; note v9 takes price+volume precision. |
| `screenshot()` | `getConvertPictureUrl(includeOverlay, type, bg)` | native | v1.5; returns data URL. |

## Events (`chart.on(type, cb)` → `subscribeAction`)

TickLine's `on(...)` wraps `subscribeAction(ActionType, cb)` / `unsubscribeAction`. v9 `ActionType`:

| TickLine event | v9 `ActionType` | Status |
|---|---|---|
| `crosshairMove` | `OnCrosshairChange` | native |
| `visibleRangeChange` | `OnVisibleRangeChange` | native |
| `click` | `OnCandleBarClick` | native |
| `needHistory` | via `setLoadDataCallback` (Forward=older/prepend) | ✅ done |
| `drawingCreated/Modified/Removed` | via overlay `onDrawEnd`/`onPressedMoveEnd`/`onRemoved` | ✅ done |
| `error` | TickLine-internal (ARCHITECTURE §10) | ✅ done |

Other available actions (unused by v1): `OnZoom`, `OnScroll`, `OnDataReady`, `OnTooltipIconClick`, `OnPaneDrag`.

## DrawTool → v9 overlay name (lift from `PriceChart.tsx`)

Names not in this table pass straight through as v9 overlay names, so `draw("priceChannelLine")` works.
The v1.5 names below are **not registered yet** and draw nothing.

| TickLine `DrawTool` | v9 overlay name |
|---|---|
| `trendline` | `segment` |
| `ray` | `rayLine` |
| `hline` | `horizontalStraightLine` |
| `vline` | `verticalStraightLine` |
| `rect` | **`rect` (custom-registered by TickLine)** — v9 ships a `rect` *figure* but **no `rect` overlay**; TickLine registers a 2-point bounding-box overlay over that figure in `src/overlays.ts`. |
| `fib` | `fibonacciLine` |
| `text` | `simpleAnnotation` |
| v1.5 (`channel`, `pitchfork`, `gann`, `position`, `fibTime`, volume-profile) | `registerOverlay` (custom) |

> **Verified registered v9 overlays** (`getSupportedOverlays()`): `fibonacciLine,
> horizontalRayLine, horizontalSegment, horizontalStraightLine, parallelStraightLine,
> priceChannelLine, priceLine, rayLine, segment, simpleAnnotation, simpleTag,
> straightLine, verticalRayLine, verticalSegment, verticalStraightLine`. Note
> **`priceLine` IS native** (used by `ChartController.priceLine`); **`rect` is NOT**
> (custom-registered). `PriceChart.tsx`'s `rect→rect` assumption was wrong.

## Built-in indicators (Tier 1) available in v9

**Verified at runtime (2026-10-04)** with `getSupportedIndicators()` on `9.8.12`. 27 built-ins:
`AVP · AO · BIAS · BOLL · BRAR · BBI · CCI · CR · DMA · DMI · EMV · EMA · MTM · MA · MACD · OBV · PVT · PSY · ROC · RSI · SMA · KDJ · SAR · TRIX · VOL · VR · WR`.
Every name in TickLine's `BuiltinIndicator` type (EMA, MA, SMA, MACD, RSI, VOL, BOLL, KDJ, SAR, WR) is
present; the rest pass through as `string`. (`AVP` = average price, missing from the earlier list.)

The overlay registry was re-verified the same way and matches the list above.

## v9 engine facts (don't re-discover)

Hard-won behaviour of KLineChart `9.8.12` that TickLine's code depends on.

1. **Load directions:** `Forward` = **older** bars (prepend, scroll-left backfill, fires when `from === 0`). `Backward` = **newer** bars (append), and it fires right after `applyNewData` because the view starts pinned to the right.
2. **A Backward append keeps the right-edge offset**, so the view jumps to the new end. Compensate with `scrollByDistance(+n × barSpace)` (positive = toward older) and decline the re-entrant fire.
3. **`scrollToTimestamp` / `scrollToDataIndex` put the target at the right edge**, not the centre. Centring needs `scrollToDataIndex(idx + halfScreen)`.
4. **`getVisibleRange()` returns bar indices**, not timestamps.
5. **`OnVisibleRangeChange` fires synchronously** inside a programmatic scroll, so an echo guard can be a try/finally flag; no timer needed.
6. **Overlay timestamps clamp to the nearest loaded bar** on every redraw. Only draw an annotation while its bar is loaded (the TradeLayer rule).
7. **`updateData` only appends or replaces the last bar**; anything older is silently ignored.
8. **Styles merge and never reset.** Every theme palette must set the same keys, or switching back leaves the other theme's colours behind.
9. **`addData` mutates the data list synchronously** before its first `await`, so `getDataList()` is current right after `params.callback()` / `applyNewData()`.
10. **No standalone panes, no crosshair setter, no `rect` overlay, no bulk overlay export.** TickLine composes each one (see the tables above).

## Summary — what's real build work (not thin wrappers)

1. **`plotSeries` as a custom `registerIndicator`** (Tier-2 external-series host). *Still open.*
2. ~~**`priceLine` + `setMarkers`** as overlays~~ ✅ `priceLine` is native; markers, positions and levels are custom overlays.
3. ~~**Pane lifecycle**~~ ✅ v9 has no `createPane`; panes are indicator side-effects.
4. ~~**`setVisibleRange` + `setCrosshair`**~~ ✅ composed (crosshair = linked-cursor overlays).
5. ~~**`serialize`/`restore`**~~ ✅ wrapper-side registry walk.
6. ~~**`setLoading` + error channel**~~ ✅ TickLine-owned overlay and event.
7. ✅ **Bounded-feed paging** (`getRange`, newer-bar Backward paging with view compensation, `jumpTo` centring).

8. ⚠ **Imperative `prependData`**: needs a real prepend path (see Lifecycle & data). Low priority; the
   load callback covers normal backfill.

Everything else is a thin pass-through. **No blocking surprises** — the v1 Tier-1 chart is fully expressible on v9 `9.8.12`.
