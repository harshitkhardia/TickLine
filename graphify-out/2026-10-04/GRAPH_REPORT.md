# Graph Report - TickLine  (2026-10-04)

## Corpus Check
- 56 files · ~46,784 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 6, .css 2)

## Summary
- 950 nodes · 2127 edges · 42 communities (35 shown, 7 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 203 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `13c78b1b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ChartController
- aggregation.ts
- BarBuilder
- grid.ts
- main.ts
- compilerOptions
- session.ts
- compilerOptions
- demo/package.json
- __init__.py
- package.json
- widget.js
- TickLine → KLineChart v9 (`9.8.12`) API Mapping
- BacktestView
- constructor
- overlays.ts
- index.ts
- ChartController.ts
- i
- Bar
- ReplayDatafeed
- Ai
- ChartManager
- reload
- a
- Point
- emit
- SyncController
- createChart
- sync
- FakeChart
- B
- TickLine — ChartManager (multi-chart layouts) — SPEC / PLAN
- PaneId
- createSharedDatafeed
- .plotSeries
- 6. Components & public API
- 5. The five sync dimensions (D-CM4)
- .on
- .serialize
- tickline-widget

## God Nodes (most connected - your core abstractions)
1. `ChartController` - 114 edges
2. `Bar` - 46 edges
3. `Period` - 39 edges
4. `BacktestView` - 34 edges
5. `Datafeed` - 29 edges
6. `MultiPeriodAggregator` - 28 edges
7. `ChartManager` - 27 edges
8. `ReplayDatafeed` - 26 edges
9. `SyncController` - 24 edges
10. `BarBuilder` - 23 edges

## Surprising Connections (you probably didn't know these)
- `CRITICAL FINDINGS (don't re-discover)` --references--> `BarBuilder`  [INFERRED]
  kb/PROGRESS.md → src/BarBuilder.ts
- `Phase 2–4 — demo, tests, docs (Jul 4–5)` --references--> `BarBuilder`  [INFERRED]
  kb/PROGRESS.md → src/BarBuilder.ts
- `1. What TickLine is` --references--> `ChartController`  [INFERRED]
  kb/ARCHITECTURE.md → src/ChartController.ts
- `4.1 Lifecycle` --references--> `createChart()`  [INFERRED]
  kb/API.md → src/ChartController.ts
- `6.4 `ChartManager` (`src/ChartManager.ts`)` --references--> `ChartManager`  [INFERRED]
  kb/CHARTMANAGER.md → src/ChartManager.ts

## Import Cycles
- None detected.

## Communities (42 total, 7 thin omitted)

### Community 0 - "ChartController"
Cohesion: 0.11
Nodes (4): ChartController, toKLine(), LoadingState, TickLineError

### Community 1 - "aggregation.ts"
Cohesion: 0.14
Nodes (8): vitest, CloseCb, PeriodState, BarBuilderOptions, Tick, periodToMs(), CloseEvt, collect()

### Community 2 - "BarBuilder"
Cohesion: 0.05
Nodes (50): Files, TickLine — Demo, What the demo exercises, 1. Install & quick start, 2. Concepts in one minute, 3.1 `Datafeed` — bars (required), 3.2 `SeriesSource` — custom/MTF indicators (optional, Tier 2), 3.3 `Storage` — persistence (optional) (+42 more)

### Community 3 - "grid.ts"
Cohesion: 0.08
Nodes (24): applyLayout(), buildCell(), Cell, cells, DARK, DEFAULT_TF, defaultsFor(), gridEl (+16 more)

### Community 4 - "main.ts"
Cohesion: 0.07
Nodes (30): createMockDatafeed(), genBars(), PERIOD_MS, rng(), parseTs(), resolveToken(), TOKENS, createQuantPrimeDatafeed() (+22 more)

### Community 5 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit (+7 more)

### Community 6 - "session.ts"
Cohesion: 0.14
Nodes (16): 4. Arbitrary session-anchored periods (D-CM3), DEFAULT_DAYS, fmtCache, formatter(), Interval, MS, parseHm(), partsInTz() (+8 more)

### Community 7 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module, moduleResolution (+8 more)

### Community 8 - "demo/package.json"
Cohesion: 0.08
Nodes (21): dependencies, klinecharts, devDependencies, cross-env, typescript, vite, klinecharts, typescript (+13 more)

### Community 9 - "__init__.py"
Cohesion: 0.05
Nodes (35): Backtest POC track — "must-have" list (Oct 4), Bugs found & fixed in the POC track, CRITICAL FINDINGS (don't re-discover), ✅ DONE, How to resume (commands), Layout, 🔲 LEFT TO DO, Locked decisions (do NOT relitigate) (+27 more)

### Community 10 - "package.json"
Cohesion: 0.04
Nodes (45): description, devDependencies, jsdom, klinecharts, tsup, @types/react, typescript, vitest (+37 more)

### Community 11 - "widget.js"
Cohesion: 0.04
Nodes (22): Ar(), clearCrosshair(), dr(), Fa(), getPanes(), Gi(), je(), movePaneSeries() (+14 more)

### Community 12 - "TickLine → KLineChart v9 (`9.8.12`) API Mapping"
Cohesion: 0.07
Nodes (28): 1. The two libraries (different layers), 2. KLineChart Pro — does NOT solve multi-chart sync, 3. Multi-chart sync (4-chart grid), 4. TradingView parity on our stack, 5. Recommendation, Chart Library Analysis — KLineChart vs TradingView Lightweight Charts, Built-in indicators (Tier 1) available in v9, Events (`chart.on(type, cb)` → `subscribeAction`) (+20 more)

### Community 13 - "BacktestView"
Cohesion: 0.10
Nodes (17): Option A — against the QuantPrime backend (real integration path), Option B — standalone (no backend), Option C — backtest viewer (no backend), Run, 6.1 An indicator on the main pane (EMA overlay), 6.2 A sub-pane indicator (RSI), 6.3 Multi-timeframe indicator (15m EMA on a 1m chart), 6.4 Drawing tools + persistence (+9 more)

### Community 14 - "constructor"
Cohesion: 0.10
Nodes (32): buildReplay(), clockText(), constructor(), defaultReplayStart(), dispose(), emitState(), Er(), G() (+24 more)

### Community 15 - "overlays.ts"
Cohesion: 0.06
Nodes (28): data, view, LOSS, LOSS_FILL, PROFIT, PROFIT_FILL, Coord, Fig (+20 more)

### Community 16 - "index.ts"
Cohesion: 0.17
Nodes (17): 7.1 Backtest toolkit (added for the QuantPrime strategy POC), Datafeed, BacktestAnnotations, BacktestViewOptions, SPEEDS, Cell, attachReplay(), ReplayOptions (+9 more)

### Community 17 - "ChartController.ts"
Cohesion: 0.12
Nodes (21): DrawTool → v9 overlay name (lift from `PriceChart.tsx`), Handler, OVERLAY_NAME, PaneRec, ChartManagerOptions, DEFAULT_SYNC, Dim, LogicalDrawing (+13 more)

### Community 19 - "i"
Cohesion: 0.12
Nodes (23): A(), de(), E(), ensureAction(), Ge(), i(), j(), kr() (+15 more)

### Community 21 - "ReplayDatafeed"
Cohesion: 0.18
Nodes (4): ReplayDatafeed, Hub, ReplayState, Unsubscribe

### Community 22 - "Ai"
Cohesion: 0.13
Nodes (18): Ai(), ao(), Cr(), Di(), Ei(), Ii(), Jt(), ki() (+10 more)

### Community 23 - "ChartManager"
Cohesion: 0.22
Nodes (5): 5.1 Symbol / 5.2 Interval, 8. Build order, ChartManager track — multi-chart grid (Jul 12; full spec in [CHARTMANAGER.md](CHARTMANAGER.md) §8), ChartManager, GridSnapshot

### Community 24 - "reload"
Cohesion: 0.15
Nodes (16): ae(), centerOn(), emitError(), feedRange(), get(), getBars(), getRange(), jumpTo() (+8 more)

### Community 25 - "a"
Cohesion: 0.24
Nodes (15): e(), Fi(), Jr(), Li(), mt(), n(), O(), qt() (+7 more)

### Community 26 - "Point"
Cohesion: 0.23
Nodes (5): OverlayRec, DrawingId, DrawStyle, Point, TickLineEvents

### Community 27 - "emit"
Cohesion: 0.16
Nodes (15): addIndicator(), clearDrawings(), createTracked(), draw(), emit(), fromV9Points(), makeOverlayHandlers(), periodMs() (+7 more)

### Community 29 - "createChart"
Cohesion: 0.23
Nodes (9): react, ChartOptions, createChart(), TickLineChart(), TickLineChartProps, bounded(), Call, fresh() (+1 more)

### Community 30 - "sync"
Cohesion: 0.23
Nodes (12): create(), invalidate(), precision(), removeAll(), setLevels(), setMarkers(), setPositions(), sync() (+4 more)

### Community 32 - "B"
Cohesion: 0.24
Nodes (11): B(), be(), gn(), hn(), ln(), Lt(), Or(), pn() (+3 more)

### Community 33 - "TickLine — ChartManager (multi-chart layouts) — SPEC / PLAN"
Cohesion: 0.24
Nodes (6): 0. What we're building & why, 1. Proposed decisions (D-CM*), 3. The hybrid forming bar (D-CM2) — provisional-tick → confirmed-1m, 7. Backend API — mostly already there, 9. Sign-offs (RESOLVED 2026-07-12), TickLine — ChartManager (multi-chart layouts) — SPEC / PLAN

### Community 34 - "PaneId"
Cohesion: 0.33
Nodes (3): BuiltinIndicator, IndicatorId, PaneId

### Community 35 - "createSharedDatafeed"
Cohesion: 0.28
Nodes (4): createSharedDatafeed(), emitTo(), ensureStarted(), getHub()

### Community 36 - ".plotSeries"
Cohesion: 0.39
Nodes (4): todo(), SeriesId, SeriesMeta, SeriesPoint

### Community 37 - "6. Components & public API"
Cohesion: 0.33
Nodes (6): 6.1 `SessionClock` (`src/session.ts`), 6.2 `MultiPeriodAggregator` (`src/aggregation.ts`) — generalizes `BarBuilder`, 6.3 `SharedDatafeed` (`src/SharedDatafeed.ts`) — implements `Datafeed`, 6.4 `ChartManager` (`src/ChartManager.ts`), 6.5 Layout catalog (grid presets), 6. Components & public API

### Community 38 - "5. The five sync dimensions (D-CM4)"
Cohesion: 0.40
Nodes (5): 5.3 Crosshair / Drawings / Indicators — three symbol-scoped flags (LOCKED), 5.4 Time — pointer anchor, scroll-into-frame, 5.5 Date range — identical window, 5.6 Implementation: `SyncController` finishes here, 5. The five sync dimensions (D-CM4)

## Knowledge Gaps
- **195 isolated node(s):** `name`, `private`, `version`, `type`, `demo` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 304 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `h()` connect `a` to `index.ts`, `widget.js`, `BacktestView`?**
  _High betweenness centrality (0.315) - this node is a cross-community bridge._
- **Why does `ChartController` connect `ChartController` to `TickLine — ChartManager (multi-chart layouts) — SPEC / PLAN`, `BarBuilder`, `grid.ts`, `main.ts`, `PaneId`, `.plotSeries`, `.on`, `.serialize`, `TickLine → KLineChart v9 (`9.8.12`) API Mapping`, `BacktestView`, `overlays.ts`, `index.ts`, `ChartController.ts`, `ReplayDatafeed`, `ChartManager`, `Point`, `SyncController`, `createChart`?**
  _High betweenness centrality (0.261) - this node is a cross-community bridge._
- **Why does `BacktestView` connect `BacktestView` to `ChartController`, `__init__.py`, `TickLine → KLineChart v9 (`9.8.12`) API Mapping`, `overlays.ts`, `index.ts`, `Bar`, `ReplayDatafeed`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `ChartController` (e.g. with `2. Concepts in one minute` and `4. `ChartController` API`) actually correct?**
  _`ChartController` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Bar` (e.g. with `1. Proposed decisions (D-CM*)` and `3. The hybrid forming bar (D-CM2) — provisional-tick → confirmed-1m`) actually correct?**
  _`Bar` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `BacktestView` (e.g. with `Option C — backtest viewer (no backend)` and `6.6 Backtest viewer & bar replay`) actually correct?**
  _`BacktestView` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `Datafeed` (e.g. with `2. Concepts in one minute` and `3.1 `Datafeed` — bars (required)`) actually correct?**
  _`Datafeed` has 10 INFERRED edges - model-reasoned connections that need verification._