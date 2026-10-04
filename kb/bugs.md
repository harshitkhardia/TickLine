# TickLine — Bugs

Architecture-level bugs found in the 2026-10-04 audit (code vs `kb/` vs KLineChart `9.8.12`). **All nine are fixed**, with regression tests in [src/__tests__/bugfixes.test.ts](../src/__tests__/bugfixes.test.ts). Smaller known limitations that aren't bugs are listed in [PROGRESS.md](PROGRESS.md#-left-to-do).

New bugs go in the "Open" table with the next free id, and move to "Fixed" with a one-line fix and a test.

## Open

None.

## Fixed

| ID | Severity | What was wrong | Fix |
|---|---|---|---|
| BUG-01 | High | `setVisibleRange` scrolled `from` to the **right** edge, pushing the requested window off screen, and sized bars from wall-clock time, so nights and weekends squashed NSE candles ~4×. | Pins `to` at the right edge (`scrollToDataIndex`) and sizes bars from the bars actually loaded in the window. **Also found:** v9's `getVisibleRange()` returns bar indices, so `getVisibleRange()`, `visibleRangeChange` and `serialize().viewRange` now convert to ms. |
| BUG-02 | High | A fixed 7-day load/paging window: ~5 bars on a daily chart, 1 on weekly, 604 800 on 1-second. | Window = 7 days or 500 bars, whichever is longer, capped at 20 000 bars (`windowMs()`). |
| BUG-03 | High | After `jumpTo` into history, scrolling back to the newest bar never re-subscribed, so the chart stopped updating live. | `armLive()` re-subscribes when paging reaches the live edge (bounded feeds: `range.to`; live feeds: now). Stale pages from before a reload are discarded. |
| BUG-04 | High | `SharedDatafeed` seeded its 1m spine from `[now − 2h, now]`: empty for historical feeds, and too short to build correct 4h/1d bars. | Seed ends at `getRange().to` for bounded feeds and spans at least 1 day or the chart's period. **Also fixed:** `MultiPeriodAggregator` froze its keep-window at 2h before any period was added and pruned the seed; it's now recomputed on `addPeriod`, minimum 1 day. |
| BUG-05 | Medium | `BarBuilder` bucketed on a UTC floor, so live NSE 1h/30m bars started at 08:30/09:30 IST while the backend's started at 09:15/10:15, and the two never merged. | `BarBuilder` accepts a `session` (via `SessionClock`); `QuantPrimeDatafeed` passes NSE 09:15–15:30 IST. *Not verified:* the `1d` bar stamp. |
| BUG-06 | Medium | `ChartManager` replicated indicator **adds** to same-symbol charts but had no remove, so siblings kept deleted indicators. | `ChartManager.removeIndicator(chart, id)` fans out by name and main/sub-pane placement. |
| BUG-07 | Medium | Date-range echo suppression relied on a 60 ms timer: too short on slow machines (echo loops), long enough to swallow fast pans. | v9 fires the range event synchronously, so the guard is held with try/finally for the duration of `setVisibleRange`. No timer. |
| BUG-08 | Low | A marker without an explicit price stayed at the forming bar's old high/low as the bar grew. | Such markers re-anchor (`overrideOverlay`) when the forming bar's high/low/close moves. |
| BUG-09 | Low | Unbuilt Tier-2 methods (`plotSeries`, `movePaneSeries`…) threw synchronously, breaking the error contract (ARCHITECTURE §10). | They emit `{ kind: "series", retryable: false }` on the error channel and do nothing; `plotSeries` returns `""`. |
