# TickLine KB — Archive

Old research kept for the record. **Nothing here is current; don't build from it.** The live docs are one folder up; start at [../OVERVIEW.md](../OVERVIEW.md).

| File | What it is | Why it's here |
|---|---|---|
| `spike.md` | The original vision: a multi-language, engine-swappable library where "the JSON protocol is the product". Also the prior-art survey (louisnw01/lightweight-charts-python and others). | Dropped by D-T1. Kept because it records *why* TickLine became a KLineChart-only TS library. |
| `chart_library_analysis.md` | KLineChart vs TradingView Lightweight Charts, written for QuantPrime (it backs QuantPrime's D-023). | The engine choice is settled (D-T3). Its "next step" (a sync controller and datafeed contract) was built as `SyncController` and `Datafeed`. Links point into `QuantPrime/`. |
| `inputs_from_gemini.md` | Pasted notes on building a chart library from scratch vs wrapping one. | Raw early research. |
| `other_analysis.md` | Pasted survey of Lightweight Charts wrappers (React, Python, Streamlit). | Raw early research. |
| `PROGRESS-2026-10-04.md` | The build log as it stood before the KB cleanup, including the doc-review log. | Replaced by a slimmer [../PROGRESS.md](../PROGRESS.md). Kept because TickLine has no git history. |
| `bugs-audit-2026-10-04.md` | The original audit of BUG-01–09, with code excerpts and remediation plans. | All nine are fixed, sometimes differently from the plan. Current list: [../bugs.md](../bugs.md). |

Links inside archived files may point at paths that have since moved.
