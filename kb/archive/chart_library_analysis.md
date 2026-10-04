# Chart Library Analysis — KLineChart vs TradingView Lightweight Charts

> Supports **D-023** (charts: KLineChart). Captures the multi-chart sync + TradingView-parity analysis so we don't re-litigate. See [DECISIONS.md](../../../QuantPrime/kb/DECISIONS.md), [lld/LLD-3-frontend.md](../../../QuantPrime/kb/lld/LLD-3-frontend.md). Implementation: [../frontend/src/components/PriceChart.tsx](../../../QuantPrime/frontend/src/components/charts/PriceChart.tsx).

## 1. The two libraries (different layers)

| | **KLineChart** (our choice, D-023) | **TradingView Lightweight Charts** |
|---|---|---|
| License | MIT | Apache 2.0 |
| Layer | Chart **toolkit** (batteries included) | Rendering **primitive** |
| Drawing tools | ✅ Built-in overlay engine | ❌ DIY (fragile SVG) |
| Built-in indicators | ✅ ~50+ (MA/EMA/MACD/RSI/BOLL/KDJ/VOL…) | ❌ None — compute + feed yourself |
| Multi-pane (sub-windows) | ✅ Native | ⚠️ Newer/limited |
| Bundle / perf | ~45 KB, very good | ~35 KB, leanest |
| API stability | More churn (pinned `9.8.12`; v10 has breaking changes) | Very stable, first-party |
| Cross-chart sync APIs | ⚠️ Possible, manual | ✅ Purpose-built + documented |

**Decision rationale (D-023):** KLineChart's built-in **drawing tools + indicators** are the expensive-to-build TradingView features, and they're free on this base. Lightweight is smaller/faster but would force us to hand-roll both. Net custom-code bill is lower on KLineChart for a full terminal.

## 2. KLineChart Pro — does NOT solve multi-chart sync

- `@klinecharts/pro` is **free/open-source (Apache 2.0)**, not a paid tier. It's a polished **single-chart UI shell** (symbol search, period bar, indicator/drawing UI, settings, themes, **Datafeed interface**) on top of core.
- Each `new KLineChartPro()` is **one chart**. Its "multi-pane" = panes *inside* one chart, **not** a grid of charts.
- ❌ No multi-chart grid, no linked charts, no cross-chart crosshair/zoom sync.
- Worse for us: its wrapper hides the underlying instance we need for sync hooks, and we'd lose our custom drawing toolbar.
- ✅ Worth **borrowing**: its **Datafeed interface** `(symbol, period) → history + realtime` (write a `KiteDatafeed`).

## 3. Multi-chart sync (4-chart grid)

**Neither library has built-in multi-chart linking.** Sync is always an **app-layer** job — a shared store driving each instance. Two buckets:

**A. Config sync (state-driven) → KLineChart easier**
TF/interval, indicators, markers. You push state to all charts. KLineChart wins because indicators/overlays are built-in (one-line `createIndicator`); Lightweight makes you own every indicator's math.

**B. Interaction sync (event-driven) → Lightweight's APIs cleaner**
| Sync | KLineChart | Lightweight |
|---|---|---|
| Crosshair (hover → highlight same time) | `subscribeAction('crosshair')` | ✅ `subscribeCrosshairMove` / `setCrosshairPosition` |
| Zoom / pan / visible range | `subscribeAction('scroll'/'zoom')` + `scrollToTimestamp` | ✅ `subscribeVisibleLogicalRangeChange` / `setVisibleLogicalRange` |

**Cross-timeframe gotcha:** the reference layout mixes TFs (1h/4h). Sync by **logical index breaks** across TFs; sync by **timestamp works** (crosshair snaps to the containing bar). Design sync around timestamps.

## 4. TradingView parity on our stack

~90% of TradingView's *chart* surface is reachable on KLineChart core, because the two hardest pieces (indicators, drawing tools) are built in.

**Free on KLineChart:** candle/line/area, indicators, drawing tools, multi-pane, crosshair, realtime, themes, mobile.
**Custom indicators:** handled by our **backend Python (Pine-like) engine** computing series → chart (our Pine-Script analogue).
**Borrow Lightweight's API *shape* (not code):** `subscribeVisibleLogicalRangeChange`/`setVisibleLogicalRange` (zoom sync) · `subscribeCrosshairMove`/`setCrosshairPosition` (crosshair sync) · `createPriceLine` (entry/SL/TP lines) · `setMarkers()` (signal markers).
**Borrow KLineChart Pro:** Datafeed interface.

**Genuine gaps — we build these (same effort in any library):**
1. Multi-chart grid + link-groups (TradingView colored-link feature)
2. `ChartSyncController` (shared store + per-instance adapter driving all panes)
3. Symbol search (over our instruments table)
4. Bar replay (incremental feed)
5. Chart state persistence (drawings + layout → SQLite KV, per D-024)

## 5. Recommendation

- **Stay on KLineChart core** (D-023). Don't adopt Pro (doesn't solve sync, removes control).
- Build a small library-agnostic **`ChartSyncController`** (store + thin per-instance adapter via KLineChart `subscribeAction`). Keeps a future Lightweight swap cheap.
- Default to **opt-in sync** (TradingView-style link groups): always sync symbol + markers; make TF/indicators/crosshair/zoom toggleable — a 4-pane view is usually for seeing 4 *different* TFs.
- Shape sync/datafeed/marker/price-line APIs after Lightweight + Pro so borrowed patterns stay clean, not Frankenstein.

**Next step:** spec `ChartSyncController` + `Datafeed` TypeScript contracts into [lld/LLD-3-frontend.md](../../../QuantPrime/kb/lld/LLD-3-frontend.md).
