# TickLine in QuantPrime

How QuantPrime, TickLine's first consumer, plugs into it. Everything QuantPrime-specific lives here, so the library docs stay consumer-neutral (D-T1).

- **Today** QuantPrime's own frontend still draws charts with KLineChart directly. Swapping to TickLine is planned for QuantPrime v1.5 (QuantPrime D-069). The TickLine demo already runs against the QuantPrime backend.
- **The adapter** lives in the TickLine demo: [demo/src/adapters/QuantPrimeDatafeed.ts](../../demo/src/adapters/QuantPrimeDatafeed.ts) with [qp-shared.ts](../../demo/src/adapters/qp-shared.ts). It is not part of the published library.

---

## The adapters

| TickLine adapter | QuantPrime side |
|---|---|
| `Datafeed.getBars` | `GET /api/history?token&tf&days`. TickLine asks for a range; the adapter converts it with `days = ceil((to − from) / 86_400_000)` (R-T3). |
| `Datafeed.subscribe` | `/ws/ticks`. It streams **quote ticks, not bars**, so the adapter builds bars with `BarBuilder`, passing the NSE session (09:15–15:30 IST) so live 1h/30m bars line up with the backend's buckets. |
| `SeriesSource` | **Nothing yet.** QuantPrime has no `/series` endpoint, so Tier-2 series can't be used. Tier-1 built-in indicators work with no backend changes. A strategy's `plot()` output (QuantPrime LLD-3 §7) is not a general indicator service. |
| `Storage` | QuantPrime's SQLite key-value store (its D-024). TickLine hands back a JSON snapshot; QuantPrime decides where it's saved. |
| `SessionSpec` | NSE 09:15–15:30 IST now; MCX and 24h crypto when those markets arrive. |

## Things that bite

- **Timestamps.** QuantPrime sends `ts` as a **naive-UTC ISO string** (`"2026-07-04T12:34:56.789000"`, no `Z`). Append `"Z"` before `Date.parse`, or every bar shifts by the browser's offset.
- **Tokens, not symbols.** QuantPrime endpoints take an integer `token`. The demo maps one symbol: NIFTY 50 → `256265`. Unknown symbols silently fall back to NIFTY.
- **Unsupported timeframes fall back to 5m** on the server, silently. The demo restricts its period list for that reason.
- **What `/history` returns.** Real DuckDB bars for ingested instruments (NIFTY 50 at 1m/5m/15m/1h/1d), otherwise a synthetic series flagged `mock: true`. Real data ends at the last ingest, so the demo opens on that final week.
- **Live ticks are mock.** `/ws/ticks` sends ~1 Hz synthetic quote snapshots, not trade prints, so tick-built volume is approximate. The multi-chart grid corrects closed bars from 1m data (D-CM2).
- **One socket per symbol.** `QuantPrimeDatafeed` opens a WebSocket per `subscribe()`. Behind `ChartManager`'s `SharedDatafeed` that becomes one per symbol, so a NIFTY + BANKNIFTY grid opens 2 sockets. One socket per manager (`/ws/ticks?tokens=A,B`) needs a multiplexing adapter that isn't built.
- **DuckDB lock.** `quant.duckdb` allows one writer. Stop the QuantPrime backend (or read a copy) before opening it from a notebook.

## What the multi-chart grid needs from the backend

Nothing new for D-CM1–4:

| Need | QuantPrime today |
|---|---|
| A live feed per symbol | ✅ `/ws/ticks?tokens=…` |
| Per-timeframe backfill | ✅ `/history?token&tf&days` |
| Authoritative 1m OHLCV to reconcile closed bars | ✅ DuckDB 1m bars via `/history` for ingested tokens |
| A live stream of closed 1m bars | ⬜ Optional upgrade (`/ws/bars?tf=1m`). Today the 1m layer is built from the same ticks. |

When QuantPrime goes live through Zerodha (via OpenAlgo), the real tick feed is richer than the mock. Kite's `volume_traded` is **cumulative day volume**, so per-bar volume has to be derived, and Zerodha recommends its historical 1m candles as the authoritative per-candle volume. That is exactly the source D-CM2 reconciles from ([forum/14999](https://kite.trade/forum/discussion/14999)). Kite ticks come in three modes: LTP; Quote (adds last qty, average price, cumulative volume, buy/sell totals, day OHLC); and Full (adds exchange timestamp, OI and 5-level depth).

## The backtest POC

The backtest toolkit (`BacktestView`, replay, trade annotations, the Jupyter widget) was built so a QuantPrime strategy backtest can be viewed in a notebook. Whether it stays core to TickLine is open (Q-T1 in [../DECISIONS.md](../DECISIONS.md)). Remaining QuantPrime-side work:

- Notebook `QuantPrime/backend/notebooks/pdl_sweep_backtest.ipynb`: DuckDB NIFTY 1m → PDH/PDL sweep + engulfing / morning-star detection → backtesting.py → stats, equity, monthly table → `TickLineChart`.
- Cross-check the trade list through BrokerSimulator to include Indian charges.
- Validate scroll-back backfill against the real QuantPrime backend (`/history?days=`).
