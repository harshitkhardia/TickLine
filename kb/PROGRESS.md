# TickLine — Build Progress

What's done, what's left, and how to run it, so the next session can resume without re-discovery. **Last updated: 2026-10-04.**

New here? Read [OVERVIEW.md](OVERVIEW.md) first. Before changing code, also read [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md) and the **v9 engine facts** in [KLINECHART_MAPPING.md](KLINECHART_MAPPING.md#v9-engine-facts-dont-re-discover).

## How to resume (commands)

```bash
cd TickLine
npm run typecheck   # must stay clean (covers src/ + widget/)
npm test            # 79 tests (vitest + jsdom, klinecharts mocked)
npm run build       # dist/ (npm lib) + dist/standalone/ (IIFE) + python/tickline_widget/static/widget.js

# demos (use ../src live via a vite alias)
cd demo && npm install
npm run demo            # single chart, needs the QuantPrime backend on :8000
npm run demo:mock       # single chart, no backend
npm run demo:grid       # multi-chart grid (ChartManager)
npm run demo:backtest   # BacktestView: trades, positions, PDH/PDL, bar replay

# Jupyter widget
uv pip install -e "./python[dev]" && python -m pytest python/tests   # 7 tests
```

## Layout

| Path | What |
|---|---|
| `src/` | The library (TypeScript). Public entry `src/index.ts` |
| `widget/anywidget.ts` | Jupyter front-end, bundled with klinecharts into `python/tickline_widget/static/widget.js` |
| `python/` | `tickline-widget` Python package (anywidget): `TickLineChart`, `prev_day_levels`, `trades_to_annotations` |
| `demo/` | Vite demos: `index.html` (single), `grid.html` (ChartManager), `backtest.html` (BacktestView) |
| `kb/` | Design docs. Map in [../README.md](../README.md#docs) |

---

## ✅ Done

| When | Track | What landed |
|---|---|---|
| Jul 4 | **ChartController foundations** | Panes and the `"main"` pane, events, overlay registry, loading/error overlay, `setSymbol`/`setPeriod`, automatic scroll-back backfill, `autoResize`, pane lifecycle, `zoomTo`, precision. |
| Jul 4–5 | **Demo, tests, docs** | Vite demo with `QuantPrimeDatafeed` and `MockDatafeed`; drawing events, silent `restore()`, debounced auto-save; custom `rect` overlay; native `priceLine`. |
| Jul 12 | **Multi-chart grid** ([CHARTMANAGER.md](CHARTMANAGER.md) §8) | `SessionClock` (any minute period, session-anchored), `MultiPeriodAggregator`, `SyncController` (7 sync flags, echo suppression, linked cursor), `SharedDatafeed`, `ChartManager`. Grid demo with 12 layout presets and a sync panel. |
| Oct 4 | **Backtest POC** | See the table below. |
| Oct 4 | **Bug audit** | BUG-01–09 fixed with regression tests ([bugs.md](bugs.md)). |
| Oct 4 | **KB cleanup** | Docs checked against the code; decisions merged into [DECISIONS.md](DECISIONS.md); QuantPrime details moved to [integrations/quantprime.md](integrations/quantprime.md); old research archived. |

### Backtest POC — "must-have" list

Goal: show a Python (backtesting.py) backtest on TickLine inside a notebook, TradingView style, with replay.

| # | Item | Where | Notes |
|---|---|---|---|
| 1 | **`setMarkers`** | `overlays.ts` (`tlMarker`), `tradeLayer.ts` | arrowUp/arrowDown/circle/square + text, anchored at bar high/low/close or an explicit `price`. |
| 2 | **Position boxes** `setPositions` | `tlPosition` | TP zone, SL zone, entry line, header label, dashed entry→exit line, R-multiple chip. Open trades grow bar by bar. |
| 2b | **Levels** `setLevels` | `tlLevel` | PDH/PDL-style spans with labels. |
| 3 | **Standalone bundle** | `tsup.config.ts` | `dist/standalone/tickline.global.js` (IIFE, global `TickLine`, klinecharts inlined, ~240 KB). |
| 4 | **Jupyter widget** | `widget/`, `python/` | anywidget. Bars cross as packed float64 bytes. Reads backtesting.py's `_trades` directly. |
| 5 | **Bar replay** | `ReplayDatafeed.ts`, `BacktestView.ts` | play/pause/step/seek/speed (1–300 bars/s), scrubber, shortcuts. Annotations appear as the replay reaches them. |
| 6 | **Chunked loading** | `StaticDatafeed.ts`, `Datafeed.getRange?` | Bounded feeds open at their end and page older **and** newer bars. `jumpTo(ts)` centres a window anywhere in history. |
| 7 | **Themes** | `theme.ts` | Full dark/light palettes + container background; `setTheme()` at runtime. |
| + | **`BacktestView`** | `BacktestView.ts` | Shared viewer (Chart\|Replay, transport, ◀ trade ▶). Used by the backtest demo and the widget. |

Verified with headless Edge screenshots: a static chart with a centred trade (dark and light), replay mid-trade, the real `widget.js` driven by a fake anywidget model, and the Vite backtest demo.

---

## 🔲 Left to do

### Next
- The QuantPrime side of the backtest POC (notebook, BrokerSimulator cross-check): [integrations/quantprime.md](integrations/quantprime.md#the-backtest-poc).

### Nice-to-have for the POC
- Date-range sync: force-align charts on load and when the flag is switched on.
- Widget → Python feedback (replay cursor and clicked trade as synced traits).
- Marker/label de-cluttering when trades sit on adjacent bars.

### Deferred
- **Tier-2 series** (`plotSeries` / `updateSeries` / `removeSeries`): a custom "external-series" indicator. Build against a mock `SeriesSource` first. (~1.5–2 days)
- **`movePaneSeries`**: remove + re-add (needs Tier 2).
- **Known limitations** (documented in API.md):
  - `prependData` drops older bars, because v9 `updateData` only appends or replaces the last bar. Normal backfill is unaffected.
  - `draw(style)` and `priceLine` `label`/`dash` are recorded but not applied.
  - A single chart ignores `ChartOptions.session`.
  - The grid demo's relayout loses drawings and indicators.
- React wrapper: reactive props, StrictMode double-mount.
- Grid: whole-grid persistence UI, splitters, maximize, per-instrument session calendars.
