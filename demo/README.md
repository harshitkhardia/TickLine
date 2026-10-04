# TickLine — Demo

A runnable demo of TickLine against a **live Datafeed**. Two adapters:

- **`QuantPrimeDatafeed`** (primary) — hits the QuantPrime backend's `/api/history`
  + `/ws/ticks`. The WS emits quote snapshots, so the adapter aggregates **tick→bar**
  via TickLine's `BarBuilder` (exactly the [ARCHITECTURE.md](../kb/ARCHITECTURE.md) §2 path for QP).
- **`MockDatafeed`** (fallback) — in-memory random walk; no backend needed.

## Run

### Option A — against the QuantPrime backend (real integration path)

```bash
# 1. Start the QP backend (real ingested bars where available, mock ticks)
cd ../../QuantPrime/backend
uvicorn app.main:app --port 8000

# 2. In another terminal, start the demo
cd ../../TickLine/demo
npm install
npm run demo          # http://localhost:5173
```

`/history` serves **real** DuckDB bars for ingested instruments (NIFTY 50, token
256265, which is the demo's only mapped symbol) and the badge shows **LIVE**. For
anything not ingested, it falls back to synthetic bars flagged `mock:true` and
the badge shows **MOCK**. Live ticks on `/ws/ticks` are still ~1 Hz mock quote
snapshots. Real ingested data ends at the last ingest, so the chart shows that
final week.

### Option B — standalone (no backend)

```bash
npm install
npm run demo:mock     # VITE_USE_MOCK=1 -> in-memory random walk
```

### Option C — backtest viewer (no backend)

```bash
npm install
npm run demo:backtest # http://localhost:5173/backtest.html
```

`BacktestView` (the same component the Jupyter widget mounts) over 40 synthetic NIFTY-like 1m sessions
with simulated stop / 2R trades and PDH/PDL. Try **Replay**, ▶, the speed menu, the scrubber and ◀ trade ▶.
The multi-chart grid is `npm run demo:grid`.

## What the demo exercises

| Capability | TickLine API |
|---|---|
| Live chart from a Datafeed | `createChart` → `setSymbol` → `setPeriod` |
| Tick → bar aggregation | `Datafeed.subscribe` + `BarBuilder` |
| Scroll-left backfill | `setLoadDataCallback` → `needHistory` → `getBars` |
| Overlay indicator on candles | `addIndicator("EMA","main",[20,50])` (stack=true) |
| Sub-pane indicator | `createPane` + `addIndicator("VOL", pane)` |
| Built-in drawing tools | `draw(tool)` interactive mode |
| Crosshair event | `on("crosshairMove")` → status bar |
| Layout persistence | `serialize()` / `restore()` ↔ localStorage |

## Files

```
src/
  main.ts                              # entry: wires chart + toolbar + persistence
  grid.ts / grid.css                   # multi-chart grid (ChartManager), grid.html
  backtest.ts                          # BacktestView + synthetic trades, backtest.html
  styles.css
  adapters/
    qp-shared.ts                       # ts (naive-UTC) + symbol→token map
    QuantPrimeDatafeed.ts              # /api/history + /ws/ticks + BarBuilder
    MockDatafeed.ts                    # in-memory random walk
```

The demo runs against TickLine's **live source** (`../src`) via a Vite alias, so
edits to the library hot-reload without rebuilding `dist/`.
