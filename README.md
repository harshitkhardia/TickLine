# TickLine

A standalone, **KLineChart-only**, consumer-neutral TypeScript charting library. You give it data
through **adapters** and drive it through a **`ChartController`**. Multi-chart grids run through
**`ChartManager`**, and backtests are shown with **`BacktestView`** (in a browser or in Jupyter).

## Docs

> [!TIP]
> **New here?** Read [kb/OVERVIEW.md](kb/OVERVIEW.md) → [kb/glossary.md](kb/glossary.md). That's enough to explain TickLine to someone else.

**1 · Understand it**

| Doc | Read it to… |
|---|---|
| [OVERVIEW](kb/OVERVIEW.md) | Get TickLine in one page: the picture, the parts, one chart start to finish, the rules. |
| [glossary](kb/glossary.md) | Decode a name, especially the different datafeeds and bar builders. |
| [ARCHITECTURE](kb/ARCHITECTURE.md) | See the full design: adapters, indicator tiers, drawings, sync, the error contract. |

**2 · Check a decision**

| Doc | Read it to… |
|---|---|
| [DECISIONS](kb/DECISIONS.md) | Find the rule in force (D-T, R-T, D-CM) and the two open questions. |

**3 · Build with it**

| Doc | Read it to… |
|---|---|
| [API](kb/API.md) | Look up a method, type or copy-paste example. |
| [CHARTMANAGER](kb/CHARTMANAGER.md) | Work on multi-chart grids and sync. |
| [KLINECHART_MAPPING](kb/KLINECHART_MAPPING.md) | See how each method maps to KLineChart v9, and the engine facts not to re-discover. |
| [PROGRESS](kb/PROGRESS.md) | Run commands, what's done, what's next. |
| [bugs](kb/bugs.md) | Known bugs (none open). |
| [integrations/quantprime](kb/integrations/quantprime.md) | Plug TickLine into QuantPrime. |

Old research (the original multi-language spike, library comparisons) is in [kb/archive/](kb/archive/).

## Status

**v1 core is built.** It covers the single chart, drawings, multi-chart grid with sync, and the
**backtest toolkit**: trade markers, TradingView-style position boxes, level lines, bar replay, chunked
in-memory feeds, dark/light themes, and a Jupyter widget. Tier-2 host-computed series (`plotSeries`) is
the main open item. 79 TypeScript and 7 Python tests pass. See [kb/PROGRESS.md](kb/PROGRESS.md).

## Install

```bash
npm install tickline klinecharts@9.8.12
```

## Quick start

```ts
import { createChart } from "tickline";

const chart = createChart(document.getElementById("chart")!, {
  timezone: "Asia/Kolkata",   // display only; bars stay UTC (default "UTC")
  datafeed: myDatafeed,        // required
  theme: "dark",
});

await chart.setSymbol("NIFTY");
await chart.setPeriod("5m");
chart.addIndicator("EMA", "main", [20, 50]); // Tier-1 built-in, no backend
```

Backtest viewer with bar replay:

```ts
import { BacktestView } from "tickline";

new BacktestView(el, { bars, markers, positions, levels, title: "NIFTY 1m", timezone: "Asia/Kolkata" });
```

Jupyter:

```python
from tickline_widget import TickLineChart
TickLineChart(bars_df, trades=stats["_trades"], timezone="Asia/Kolkata").replay()
```

See [python/README.md](python/README.md).

React:

```tsx
import { TickLineChart } from "tickline/react";

<TickLineChart datafeed={myDatafeed} timezone="Asia/Kolkata" onReady={(c) => c.setSymbol("NIFTY")} />
```

## Build

```bash
npm install
npm run build      # dist/ (ESM+CJS+d.ts), dist/standalone/ (IIFE, klinecharts inlined),
                   # python/tickline_widget/static/widget.js (Jupyter front-end)
npm run typecheck
npm test
```

## License

MIT ([LICENSE](LICENSE)). KLineChart is a peer dependency (Apache-2.0). See [NOTICE](NOTICE).
