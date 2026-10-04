# Graph Report - TickLine  (2026-10-04)

## Corpus Check
- Corpus is ~49,441 words - fits in a single context window. You may not need a graph.

## Summary
- 712 nodes · 1555 edges · 35 communities (26 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 60 edges (avg confidence: 0.81)
- Token cost: 179,623 input · 0 output

## Community Hubs (Navigation)
- Adapter Seams & Aggregation
- Trade Annotations & Overlays
- Time, Sessions & Datafeeds
- Python Widget Tests
- Demo Data Adapters
- Library Package Config
- ChartController Core & Contracts
- Grid Demo UI
- Demo Package Config
- BacktestView Component
- Docs & Engine Decisions
- SyncController Event Replay
- ChartManager & Sync Flags
- Library TS Config
- Demo TS Config
- ChartController Stubs & Theme
- Drawing Lifecycle
- Sync Test Fakes
- Bar Replay Feed
- Notebook & QP Integration
- Demo Pages
- Panes & Indicators
- Layout Serialize & View
- Tier-2 Series & MTF
- SharedDatafeed Hub
- Sync Binder Wiring
- Sync Principles
- Product Overview
- React Wrapper
- Backtest POC Deliverables
- Anywidget Model
- Layout Snapshot Schema
- Widget Package Node

## God Nodes (most connected - your core abstractions)
1. `ChartController` - 121 edges
2. `Bar` - 43 edges
3. `BacktestView` - 39 edges
4. `Period` - 39 edges
5. `ReplayDatafeed` - 30 edges
6. `ChartManager` - 29 edges
7. `MultiPeriodAggregator` - 27 edges
8. `TradeLayer` - 23 edges
9. `SyncController` - 22 edges
10. `SessionClock` - 20 edges

## Surprising Connections (you probably didn't know these)
- `SyncController` --semantically_similar_to--> `ChartSyncController (proposed)`  [INFERRED] [semantically similar]
  src/SyncController.ts → kb/chart_library_analysis.md
- `Bar replay (replay/play/pause/step/goto_trade)` --references--> `ReplayDatafeed`  [INFERRED]
  python/README.md → src/ReplayDatafeed.ts
- `Standalone IIFE bundle (global TickLine)` --references--> `BacktestView`  [EXTRACTED]
  kb/API.md → src/BacktestView.ts
- `tickline-widget (Jupyter backtest chart)` --references--> `BacktestView`  [INFERRED]
  python/README.md → src/BacktestView.ts
- `Backtest toolkit (markers, position boxes, levels, bar replay)` --references--> `BacktestView`  [INFERRED]
  README.md → src/BacktestView.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **TickLine three adapter seams** — kb_api_datafeed, kb_api_seriessource, kb_api_storage, src_chartcontroller_chartcontroller [EXTRACTED 1.00]
- **Derive-from-base multi-chart data pipeline** — src_chartmanager_chartmanager, src_shareddatafeed_createshareddatafeed, src_aggregation_multiperiodaggregator, src_session_sessionclock, kb_chartmanager_d_cm1, kb_chartmanager_d_cm2, kb_chartmanager_d_cm3 [EXTRACTED 1.00]
- **Backtest and bar-replay toolkit** — src_backtestview_backtestview, src_replaydatafeed_replaydatafeed, src_staticdatafeed_staticdatafeed, src_tradelayer_tradelayer, kb_api_tickline_widget, kb_klinechart_mapping_annotation_visibility_rule [EXTRACTED 1.00]
- **TickLine demo pages (single chart, grid, backtest)** — demo_index, demo_grid, demo_backtest, demo_readme_tickline_demo [EXTRACTED 1.00]
- **BacktestView surfaces (browser demo + Jupyter widget + bar replay)** — src_backtestview_backtestview, demo_backtest, python_readme_tickline_widget, python_readme_bar_replay, readme_backtest_toolkit [INFERRED 0.85]
- **Datafeed adapter implementations** — readme_adapter_pattern, demo_src_adapters_quantprimedatafeed_createquantprimedatafeed, demo_src_adapters_mockdatafeed_createmockdatafeed, src_staticdatafeed_staticdatafeed, src_replaydatafeed_replaydatafeed [INFERRED 0.75]

## Communities (35 total, 9 thin omitted)

### Community 0 - "Adapter Seams & Aggregation"
Cohesion: 0.07
Nodes (38): Datafeed, SeriesSource, Storage, PeriodState, BacktestAnnotations, BacktestViewOptions, SPEEDS, Cell (+30 more)

### Community 1 - "Trade Annotations & Overlays"
Cohesion: 0.05
Nodes (33): data, view, Trade annotations (markers, positions, levels), Backtest toolkit (bounded feeds, annotations, BacktestView), Drawing/overlay framework (registerOverlay), Custom overlays rect, tlMarker, tlPosition, tlLevel, DrawTool to v9 overlay name map, LOSS (+25 more)

### Community 2 - "Time, Sessions & Datafeeds"
Cohesion: 0.07
Nodes (27): Datafeed adapter (getBars/subscribe/getRange), periodToMs helper, SessionSpec (trading hours), QuantPrime adapters (/history, /ws/ticks, SQLite KV), QuantPrimeDatafeed demo adapter, vitest, CloseCb, MultiPeriodAggregator (+19 more)

### Community 3 - "Python Widget Tests"
Cohesion: 0.07
Nodes (21): bars(), decode(), test_bars_to_bytes_column_major_sorted_and_volume_default(), test_bars_to_bytes_ts_column_and_missing_ohlc(), test_prev_day_levels_split_in_ist(), test_to_ms_naive_aware_and_epoch(), test_trades_backtesting_py_shape(), test_trades_generic_shape() (+13 more)

### Community 4 - "Demo Data Adapters"
Cohesion: 0.06
Nodes (35): genBars(), PERIOD_MS, rng(), parseTs(), resolveToken(), TOKENS, createQuantPrimeDatafeed(), HistoryResponse (+27 more)

### Community 5 - "Library Package Config"
Cohesion: 0.04
Nodes (45): description, devDependencies, jsdom, klinecharts, tsup, @types/react, typescript, vitest (+37 more)

### Community 6 - "ChartController Core & Contracts"
Cohesion: 0.08
Nodes (10): Storage adapter (load/save JSON), TickLineError, Pane lifecycle (lazy panes, sticky, auto-remove), setLoadDataCallback Forward/Backward semantics, prependData limitation (v9 updateData append-only), tickline/react TickLineChart component, ChartController, toKLine() (+2 more)

### Community 7 - "Grid Demo UI"
Cohesion: 0.08
Nodes (24): applyLayout(), buildCell(), Cell, cells, DARK, DEFAULT_TF, defaultsFor(), gridEl (+16 more)

### Community 8 - "Demo Package Config"
Cohesion: 0.08
Nodes (21): dependencies, klinecharts, devDependencies, cross-env, typescript, vite, klinecharts, typescript (+13 more)

### Community 9 - "BacktestView Component"
Cohesion: 0.22
Nodes (5): BacktestView, h(), injectCss(), decodeBars(), render()

### Community 10 - "Docs & Engine Decisions"
Cohesion: 0.16
Nodes (14): TickLine API Reference, TickLine Locked Architecture (v1), Chart Library Analysis: KLineChart vs Lightweight Charts, KLineChart, KLineChart Pro (Datafeed interface), TradingView Lightweight Charts, ChartManager Spec / Plan, TickLine to KLineChart v9 API Mapping (+6 more)

### Community 11 - "SyncController Event Replay"
Cohesion: 0.22
Nodes (4): Linked-cursor crosshair overlay (setCrosshair), setVisibleRange via setBarSpace + scrollToTimestamp, SyncController, setup()

### Community 12 - "ChartManager & Sync Flags"
Cohesion: 0.17
Nodes (4): SyncConfig (7 sync flags), Grid layout presets (demo grid.ts, 12 presets), ChartManager, GridSnapshot

### Community 13 - "Library TS Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module, moduleResolution (+8 more)

### Community 14 - "Demo TS Config"
Cohesion: 0.12
Nodes (15): compilerOptions, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit (+7 more)

### Community 15 - "ChartController Stubs & Theme"
Cohesion: 0.17
Nodes (9): Handler, OVERLAY_NAME, PaneRec, todo(), resolveTheme(), DrawingSnapshot, PriceLineStyle, SeriesId (+1 more)

### Community 16 - "Drawing Lifecycle"
Cohesion: 0.25
Nodes (7): OverlayRec, LogicalDrawing, DrawingId, DrawStyle, DrawTool, Point, TickLineEvents

### Community 17 - "Sync Test Fakes"
Cohesion: 0.19
Nodes (3): ALL_ON, FakeChart, pts

### Community 19 - "Notebook & QP Integration"
Cohesion: 0.17
Nodes (12): index.html (single-chart demo page), LIVE/MOCK data badge (real DuckDB vs synthetic bars), QuantPrime backend (/api/history + /ws/ticks), backtesting.py stats['_trades'] trade log input, Bar replay (replay/play/pause/step/goto_trade), DuckDB ohlcv table (quant.duckdb), naive_tz handling of naive datetimes, prev_day_levels (PDH/PDL per IST session) (+4 more)

### Community 20 - "Demo Pages"
Cohesion: 0.17
Nodes (10): backtest.html (BacktestView demo page), grid.html (multi-chart grid page), Grid sync-in-layout controls and active chart, Interval combobox (arbitrary timeframes e.g. 17m), Layout persistence (serialize/restore to localStorage), Scroll-left backfill (setLoadDataCallback -> getBars), TickLine Demo, createMockDatafeed() (+2 more)

### Community 21 - "Panes & Indicators"
Cohesion: 0.29
Nodes (3): IndicatorId, PaneId, PaneOptions

### Community 23 - "Tier-2 Series & MTF"
Cohesion: 0.25
Nodes (3): SeriesSource adapter (Tier-2 series), Zerodha Kite Ticker packet modes / cumulative volume, plotSeries external-series registerIndicator (not built)

### Community 24 - "SharedDatafeed Hub"
Cohesion: 0.38
Nodes (4): createSharedDatafeed(), emitTo(), ensureStarted(), getHub()

### Community 27 - "Product Overview"
Cohesion: 0.40
Nodes (4): Backtest toolkit (markers, position boxes, levels, bar replay), KLineChart 9.8.12 (peer dependency, Apache-2.0), Tier-2 host-computed series (plotSeries) - open item, TickLine (KLineChart-only charting library)

### Community 28 - "React Wrapper"
Cohesion: 0.50
Nodes (3): react, ChartOptions, TickLineChartProps

### Community 29 - "Backtest POC Deliverables"
Cohesion: 0.50
Nodes (4): Standalone IIFE bundle (global TickLine), tickline-widget Jupyter package (TickLineChart), Backtest POC track (markers, positions, replay, widget), PDL sweep backtest notebook (QuantPrime)

## Knowledge Gaps
- **167 isolated node(s):** `name`, `private`, `version`, `type`, `demo` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 249 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ChartController` connect `ChartController Core & Contracts` to `Adapter Seams & Aggregation`, `Trade Annotations & Overlays`, `Time, Sessions & Datafeeds`, `Demo Data Adapters`, `Grid Demo UI`, `BacktestView Component`, `Docs & Engine Decisions`, `SyncController Event Replay`, `ChartManager & Sync Flags`, `ChartController Stubs & Theme`, `Drawing Lifecycle`, `Sync Test Fakes`, `Notebook & QP Integration`, `Panes & Indicators`, `Layout Serialize & View`, `Tier-2 Series & MTF`, `Sync Binder Wiring`, `Product Overview`, `React Wrapper`, `Layout Snapshot Schema`?**
  _High betweenness centrality (0.307) - this node is a cross-community bridge._
- **Why does `BacktestView` connect `BacktestView Component` to `Adapter Seams & Aggregation`, `Trade Annotations & Overlays`, `Time, Sessions & Datafeeds`, `ChartController Core & Contracts`, `Bar Replay Feed`, `Notebook & QP Integration`, `Demo Pages`, `Product Overview`, `Backtest POC Deliverables`?**
  _High betweenness centrality (0.169) - this node is a cross-community bridge._
- **Why does `tickline-widget (Jupyter backtest chart)` connect `Notebook & QP Integration` to `Product Overview`, `BacktestView Component`, `Python Widget Tests`, `Demo Pages`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ChartController` (e.g. with `createChart quick start` and `tickline/react TickLineChart component`) actually correct?**
  _`ChartController` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `BacktestView` (e.g. with `tickline-widget (Jupyter backtest chart)` and `Backtest toolkit (markers, position boxes, levels, bar replay)`) actually correct?**
  _`BacktestView` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `ReplayDatafeed` (e.g. with `Bar replay (replay/play/pause/step/goto_trade)` and `Backtest toolkit (markers, position boxes, levels, bar replay)`) actually correct?**
  _`ReplayDatafeed` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._