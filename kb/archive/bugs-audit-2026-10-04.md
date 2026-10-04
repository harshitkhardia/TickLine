# TickLine — Known Architectural Issues, Bugs & Technical Debt

> **Status:** Active audit (2026-10-04)  
> **Scope:** Audited against `src/` implementation, `kb/` design specifications, and integration with `QuantPrime` / KLineChart v9.8.12.

> **Archived copy.** This is the original audit with its remediation plans. All nine bugs are fixed; the
> fixes sometimes differ from the plans below. Current list: [../bugs.md](../bugs.md). Line references are
> from before the fixes.

---

## Resolution status (2026-10-04)

All nine fixed; regression tests in `src/__tests__/bugfixes.test.ts`.

| ID | Fix |
|---|---|
| BUG-01 | `setVisibleRange` pins `to` at the right edge via `scrollToDataIndex` and sizes bars from **loaded** bars in the window (wall-clock fallback only when the window isn't loaded). **Also found:** v9 `getVisibleRange()` returns bar *indices*, not timestamps — `getVisibleRange()`, the `visibleRangeChange` event and `serialize().viewRange` now translate to ms, so dateRange sync / restore actually work. |
| BUG-02 | `windowMs()` = clamp(500 × period, ≥7 days, ≤20 000 × period). |
| BUG-03 | `armLive()` re-subscribes when Backward paging reaches `range.to`; live (unbounded) feeds also re-arm when a `jumpTo` window reaches "now". Stale Backward pages after a reload are discarded. |
| BUG-04 | Seed ends at `getRange().to` for bounded feeds; seed span = max(1 day, subscribing period). **Also fixed:** `MultiPeriodAggregator.keepMs` was frozen at 2h (computed before any period was added) and pruned the seed — now recomputed on `addPeriod`, floor 1 day. |
| BUG-05 | `BarBuilder` accepts `session` (uses `SessionClock`); `QuantPrimeDatafeed` passes NSE 09:15–15:30 IST. Matches backend 5m/15m/30m/1h buckets. *Not verified:* `1d` stamp (QP stores daily bars separately). |
| BUG-06 | `ChartManager.removeIndicator(chart, id)` fans out by name + main/sub-pane placement. |
| BUG-07 | v9 fires `OnVisibleRangeChange` synchronously, so the echo guard is now held for the duration of `setVisibleRange` (try/finally) — no timer. |
| BUG-08 | Markers without an explicit price on the forming bar re-anchor (`overrideOverlay`) when its high/low/close moves. |
| BUG-09 | Tier-2 stubs emit `{ kind: "series", retryable: false }` on the error channel; `plotSeries` returns `""`. |

## Priority Severity Matrix

| ID | Issue | Severity | Component | Location |
|---|---|---|---|---|
| **BUG-01** | `setVisibleRange` inverse anchor & 24h bar calculation | **High (Critical UI)** | View / Sync | `src/ChartController.ts:530-538` |
| **BUG-02** | Hardcoded `WINDOW = 7 * DAY` lookback across all TFs | **High (Data Loss / Blank Chart)** | Datafeed / Paging | `src/ChartController.ts:26` |
| **BUG-03** | Dead live WebSocket subscription after scrolling history | **High (Stale Live Edge)** | Datafeed / Lifecycle | `src/ChartController.ts:316-317` |
| **BUG-04** | `SharedDatafeed` historical seed fails on `Date.now()` & 2h truncation | **High (Data Integrity)** | Multi-chart Data | `src/SharedDatafeed.ts:60-63` |
| **BUG-05** | `BarBuilder` timestamp desync on NSE 1h / 30m candles | **Medium (Alignment Collision)** | Aggregation | `src/BarBuilder.ts:24` |
| **BUG-06** | Indicator sync asymmetry in `ChartManager` (Add vs Remove) | **Medium (State Leak)** | Multi-chart Grid | `src/ChartManager.ts:101-109` |
| **BUG-07** | Fragile 60ms magic timer in `SyncController` dateRange sync | **Medium (Echo / Jitter)** | Synchronization | `src/SyncController.ts:105-108` |
| **BUG-08** | `TradeLayer` forming-bar marker anchor freezing | **Low (Visual Precision)** | Annotations | `src/tradeLayer.ts:101-107` |
| **BUG-09** | Synchronous throw on Tier-2 stubs (`plotSeries` / `movePaneSeries`) | **Low (Crash Risk)** | Indicators | `src/ChartController.ts:345` |

---

## Detailed Bug Descriptions & Remediation Plans

### BUG-01: `setVisibleRange` Window Miscalculation & Inverse Anchor
- **Location:** `src/ChartController.ts#L530-L538`
- **Code:**
  ```ts
  setVisibleRange(from: number, to: number): void {
    const span = Math.max(1, to - from);
    const width = this.el.clientWidth || 800;
    const approxBars = Math.ceil(span / this.periodMs());
    const space = Math.max(1, Math.floor(width / Math.max(1, approxBars)));
    this.chart.setBarSpace(space);
    this.chart.scrollToTimestamp(from);
  }
  ```
- **Root Cause & Impact:**
  1. **Inverse Anchor:** In KLineChart v9, `scrollToTimestamp(x)` positions `x` at the **right edge of the viewport** (as documented in TickLine's own findings). Calling `scrollToTimestamp(from)` places the start timestamp `from` at the right edge, causing the chart to display the range $(-\infty, from]$. The target window $[from, to]$ is completely pushed off-screen to the right.
  2. **Non-Continuous RTH Distortion:** `approxBars = Math.ceil(span / this.periodMs())` assumes 24h continuous trading. For Indian markets (NSE: 09:15–15:30 = 375 mins/day), a 3-day weekend span (72 wall-clock hours) calculates as 4,320 bars instead of 1,125 bars. The candle bar-spacing `space` is underestimated by ~4×, collapsing candles into microscopic hairline slivers.
- **Remediation:**
  - Pin the right edge to `to` (`this.chart.scrollToTimestamp(to)`), or find data indices via `barIndexAtOrBefore` and use `scrollToDataIndex`.
  - Calculate `approxBars` using loaded bars count within $[from, to]$ or session-aware bar count.

---

### BUG-02: Hardcoded `WINDOW = 7 * DAY` Lookback Across All Timeframes
- **Location:** `src/ChartController.ts#L26, L115, L133, L303, L307`
- **Root Cause & Impact:**
  `const WINDOW = 7 * DAY;` is used as both initial lookback and pagination step regardless of timeframe:
  - **`1d` (Daily):** 7 calendar days = **~5 trading bars**. Daily charts load virtually empty.
  - **`1w` (Weekly):** 7 days = **1 bar**.
  - **`1m` (1-minute):** 7 days = **~2,600 bars**.
  - **`1s` (1-second):** 7 days = **604,800 bars** (risks crashing or locking up the browser thread).
- **Remediation:**
  Calculate dynamic lookback window based on target bars (e.g., minimum 300 to 500 bars):
  ```ts
  const TARGET_BARS = 300;
  const windowMs = Math.max(7 * DAY, this.periodMs() * TARGET_BARS);
  ```

---

### BUG-03: Dead Live WebSocket State After Scrolling History
- **Location:** `src/ChartController.ts#L316-L317`
- **Root Cause & Impact:**
  When a user jumps to a historical timestamp (`jumpTo(ts)`), `atEnd` evaluates to `false` and `datafeedUnsub` is disconnected to prevent live bars from appending to mid-history.  
  However, as the user scrolls rightward and reaches the newest bar (handled via `LoadDataType.Backward` in `setLoadDataCallback`), `datafeedUnsub` is **never re-subscribed**. The chart remains permanently disconnected from live ticks until the user manually triggers a full reload (`setSymbol` or `setPeriod`).
- **Remediation:**
  In `setLoadDataCallback` for `LoadDataType.Backward`, check if the loaded bars reach the live edge (`!more` or `newestBar.ts >= range.to`). If reached and `!this.datafeedUnsub`, re-arm:
  ```ts
  this.datafeedUnsub = df.subscribe(this.symbol, this.period, (bar) => this.updateData(bar));
  ```

---

### BUG-04: `SharedDatafeed` Historical Seed Fails on `Date.now()` & 2h Truncation
- **Location:** `src/SharedDatafeed.ts#L60-L63`
- **Code:**
  ```ts
  const to = Date.now();
  const bars = await base.getBars(symbol, "1m", to - seedMs, to);
  if (!hub.disposed) hub.agg.seed1m(bars);
  ```
- **Root Cause & Impact:**
  1. **Historical Data:** For historical backtests or replay feeds (where data ends in the past), `[Date.now() - seedMs, Date.now()]` returns `[]`. The `1m` spine is left unseeded, breaking the derive-from-base pipeline.
  2. **Truncation for Higher TFs:** `seedMs` defaults to `2 * 3_600_000` (2 hours). For `4h` or `1d` charts in `ChartManager`, a 2-hour seed misses the morning session (09:15–13:30 IST). The resulting daily candle calculation drops the day's true Open, High, Low, and volume.
- **Remediation:**
  - If `base.getRange` is available, set `to = base.getRange(symbol, "1m").to`.
  - Dynamically scale `seedMs` to at least the largest active timeframe period or full session length (e.g. 1 full trading day).

---

### BUG-05: `BarBuilder` Timestamp Misalignment on NSE 1h / 30m Candles
- **Location:** `demo/src/adapters/QuantPrimeDatafeed.ts#L62` and `src/BarBuilder.ts#L24`
- **Root Cause & Impact:**
  `BarBuilder` uses a simple UTC midnight floor: `Math.floor(tick.ts / stepMs) * stepMs`.  
  For NSE (market opens 09:15 IST / 03:45 UTC):
  - QuantPrime backend DuckDB aligns 1h candles with `origin_offset_minutes = 225 mod width`, creating hourly buckets at **09:15–10:15, 10:15–11:15 IST**.
  - `BarBuilder` floors 03:45 UTC to `03:00 UTC` = **08:30 IST**, creating hourly buckets at **08:30–09:30, 09:30–10:30 IST**.  
  Live forming candles fail to merge into historical candles returned by `/history`, resulting in duplicate or misaligned bars.
- **Remediation:**
  Incorporate session origin offset into `BarBuilder` (or use `SessionClock.bucketOf(tick.ts, stepMs)` in `QuantPrimeDatafeed`).

---

### BUG-06: Indicator Sync Asymmetry in `ChartManager` (Add vs Remove)
- **Location:** `src/ChartManager.ts#L101-L109`
- **Root Cause & Impact:**
  `ChartManager` implements `addIndicator()` which replicates indicators across sibling charts of the same symbol when `cfg.indicators === true`.  
  However, `ChartManager` has no `removeIndicator()` method. If a user deletes an indicator from one chart, sibling charts keep it permanently.
- **Remediation:**
  Implement `removeIndicator(chart: ChartController, indicatorId: IndicatorId)` in `ChartManager` with sibling fan-out by indicator name.

---

### BUG-07: Fragile 60ms Magic Timer in `SyncController` DateRange Sync
- **Location:** `src/SyncController.ts#L105-L108`
- **Root Cause & Impact:**
  Echo-suppression during date range sync relies on a hardcoded 60ms timer:
  ```ts
  c.setVisibleRange(e.from, e.to);
  setTimeout(() => this.suppressed.delete(c), 60);
  ```
  On slower devices or dense multi-pane charts where layout/render takes >60ms, the suppression clears before `visibleRangeChange` fires on peer charts, triggering an echo-back jitter loop. Conversely, rapid smooth panning (16ms frames) can be inadvertently swallowed.
- **Remediation:**
  Replace magic timer with a generation/token-based flag or synchronous boolean guard during event dispatch.

---

### BUG-08: `TradeLayer` Forming-Bar Marker Anchor Freezing
- **Location:** `src/tradeLayer.ts#L101-L107`
- **Root Cause & Impact:**
  When a marker is placed without an explicit price (`m.price == null`), it anchors to the bar's `high` or `low`.  
  Once created, `syncMarkers` skips updating if `r.oid` already exists (`if (visible && !r.oid)`). If the forming candle makes a higher high or lower low while live ticks arrive, the marker's anchor does not adjust and floats at stale price levels.
- **Remediation:**
  For markers anchored to the latest active bar, update position with `overrideOverlay` when the bar's `high` or `low` expands.

---

### BUG-09: Synchronous Throw on Tier-2 Stubs (`plotSeries` / `movePaneSeries`)
- **Location:** `src/ChartController.ts#L345, L415`
- **Root Cause & Impact:**
  `plotSeries`, `updateSeries`, `removeSeries`, and `movePaneSeries` call `todo(...)`, which throws a synchronous JavaScript `Error`. Per `ARCHITECTURE.md §10`, the library contract states that methods should not throw synchronously but emit via `emitError`.
- **Remediation:**
  Convert synchronous throws to `emitError({ kind: "series", op: ..., retryable: false })` or return graceful no-ops.
