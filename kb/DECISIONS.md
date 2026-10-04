# TickLine — Decisions

The design calls in force **today**, in one place. Check here before proposing a change, and don't re-open a call unless the user explicitly changes it.

- **D-T*** — what TickLine is (originally in ARCHITECTURE.md).
- **R-T*** — four API questions resolved before the v1 build.
- **D-CM*** — the multi-chart grid (originally in CHARTMANAGER.md).
- **Open** — calls not made yet. Nothing there is in force.

**Rules:** a new call gets the next free id in its family. Keep each entry to a few lines and put the design detail in ARCHITECTURE, API or CHARTMANAGER. When a call changes an old one, **rewrite the old entry to the new truth**; never leave an "amended by" note for the reader to merge.

Names used below are defined in [glossary.md](glossary.md).

---

## What TickLine is (D-T)

### D-T1 — A standalone, KLineChart-only, publicly released TypeScript library
QuantPrime is the **first** consumer, not the only one, and plugs in through adapters. TickLine is consumer-neutral, **not** engine-neutral: no engine swap and no multi-language protocol (the original spike's idea, [archive/spike.md](archive/spike.md)).
→ Nothing in the library may depend on QuantPrime. QuantPrime specifics live in [integrations/quantprime.md](integrations/quantprime.md).

### D-T2 — Full drawing-tool parity (~68 tools) is the goal, phased
v1 ships the basic tools, which are KLineChart built-ins (trend line, ray, horizontal/vertical line, fib, text) plus a custom `rect`. v1.5 adds the ~60 custom tool families (Gann, pitchfork, forecasting, volume profile…).
→ Reimplement geometry from public specs. Never copy MPL-licensed code (difurious) into MIT files.

### D-T3 — KLineChart v9, pinned to `9.8.12`
Same version QuantPrime ships. v9 is stable but frozen (v10 is the active line), and that's accepted.
→ TickLine owns any v9 overlay-engine edge cases; there are no upstream fixes. Engine facts: [KLINECHART_MAPPING.md](KLINECHART_MAPPING.md).

### D-T4 — Indicators come in two tiers
**Tier 1:** standard indicators (EMA, MACD, RSI, VOL, BOLL…) are thin wrappers over KLineChart's own `createIndicator`, computed in the browser with no backend. **Tier 2:** `plotSeries` + a `SeriesSource` adapter, only for what Tier 1 can't do: multi-timeframe, strategy-parity, backtest-safe (confirmed-only) or genuinely custom series.
→ The library is useful with no backend at all. Tier 2 is designed but not built ([ARCHITECTURE §4](ARCHITECTURE.md)).

### D-T5 — Time has three separate layers
1. **Storage and wire:** `Bar.ts` is always UTC epoch ms. It never shifts.
2. **Display timezone:** presentation only, via v9's native `setTimezone` (IANA names), changeable at runtime. The library default is **UTC**; consumers pass their own (QuantPrime passes `Asia/Kolkata`).
3. **Session (trading hours):** an optional, host-supplied `SessionSpec`, separate from the display timezone. Absent means 24h-continuous buckets on wall-clock boundaries.

→ Session-anchored bucketing (bars counted from the session open) lives in `SessionClock` and is used by `MultiPeriodAggregator`, `SharedDatafeed`/`ChartManager` and, when given a `session`, `BarBuilder`. A single chart's `ChartOptions.session` is accepted but not used: a single chart plots whatever bars its feed delivers.

---

## API questions resolved before the build (R-T)

| ID | Question | Answer |
|---|---|---|
| R-T1 | Where does series `meta` live? | **Per series, not per point.** `SeriesPoint = {ts, value, confirmed}`; a request returns `{meta, points}`. Pane placement is a `plotSeries(paneId, …)` argument, not metadata. |
| R-T2 | What does `serialize()` capture? | **A full layout snapshot:** `{version, drawings, panes, seriesSpecs, viewRange}`. Series *data* is never stored, only the spec, so stale values can't leak back in. |
| R-T3 | Range or `days` for backfill? | **Always a range**, `getBars(symbol, period, from, to)`. An adapter whose backend takes `days` converts internally. |
| R-T4 | Which methods are v1 and which v1.5? | Marked per method in [ARCHITECTURE §3](ARCHITECTURE.md). v1.5: `screenshot`, `setPrecision`. `setTimezone` and `setTheme` are v1. |

---

## Multi-chart grid (D-CM)

Design: [CHARTMANAGER.md](CHARTMANAGER.md).

| ID | Decision | Consequence |
|---|---|---|
| D-CM1 | **Higher timeframes are derived from one 1m stream per symbol** at the live edge. Backfill is still fetched per timeframe. | 4 charts on 2 symbols = 2 upstream subscriptions, and a symbol's 1m and 5m charts can't disagree at the live edge. |
| D-CM2 | **The forming bar is provisional, built from ticks; on close it's rebuilt from the closed 1m bars** and replaces the provisional one (upsert by timestamp). | A fast live edge, and closed bars whose OHLCV matches the authoritative 1m data. No change to the `Bar` type. 1m OHLCV, not tick-summed volume, is the reconcile source. |
| D-CM3 | **Any integer-minute period, anchored at the session open** (1, 3, 5, 15, 17m…). The last bucket of a session may be short. | `10m`/`15m`/`17m` bars line up with the market's own candles. Implemented in `SessionClock`. |
| D-CM4 | **Seven independent sync flags.** `symbol`, `interval`, `time` and `dateRange` apply to the whole layout. `crosshair`, `drawings` and `indicators` apply only between charts **of the same symbol**. Time sync is **click-only** (hover jitters). Indicator sync copies **definitions only**; each chart recomputes on its own timeframe. | Defaults: `symbol` and `interval` off, the rest on. A UI may group the three same-symbol flags behind one switch. |
| D-CM5 | **One `SharedDatafeed` per manager owns the 1m "spine"**: it de-duplicates upstream subscriptions by symbol and fans derived bars out to each chart. | `ChartController` doesn't change; it still speaks plain `Datafeed`. |
| D-CM6 | **Grid layouts are host-side templates over `addChart`.** The library has no `layout()` method. | Presets (1×1 … 3×3) live in the demo ([CHARTMANAGER §6.5](CHARTMANAGER.md)). |

---

## Open (not decided)

| ID | Question | Why it matters |
|---|---|---|
| Q-T1 | Is the **backtest toolkit** (`BacktestView`, `StaticDatafeed`, `ReplayDatafeed`, trade annotations), the **Python widget** (`tickline-widget`) and the **standalone bundle** part of TickLine's core, a separate add-on package, or a QuantPrime POC? | They were added for the QuantPrime strategy POC without a decision, and they change what D-T1's "charting library" covers. The answer becomes **D-T6**. |
| Q-T2 | Should TickLine milestones use the **package version** (0.1, 0.2…) instead of v1/v1.5? | QuantPrime also has a v1.5 that means something else, and `package.json` already says `0.1.0`. |
