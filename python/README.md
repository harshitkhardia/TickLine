# tickline-widget

TickLine in Jupyter. A TradingView-style backtest chart: candles, buy/sell arrows,
TP/SL position boxes, PDH/PDL levels and **bar replay**. Works in JupyterLab,
Notebook 7 and VS Code notebooks.

## Install (from the TickLine repo)

```bash
cd TickLine
npm install && npm run build                 # writes python/tickline_widget/static/widget.js
uv pip install -e ./python                    # or: pip install -e ./python
```

## Use

```python
import duckdb
from tickline_widget import TickLineChart, prev_day_levels

bars = duckdb.connect("quant.duckdb", read_only=True).sql(
    "select ts, open, high, low, close, volume from ohlcv "
    "where token = 256265 and timeframe = '1m' order by ts").df()   # naive UTC

w = TickLineChart(bars, trades=stats["_trades"],       # backtesting.py trade log
                  levels=prev_day_levels(bars),          # PDH / PDL per IST session
                  title="NIFTY 1m · PDL sweep", timezone="Asia/Kolkata")
w
```

| Call | Effect |
|---|---|
| `w.replay(start=None, speed=10)` | Bar replay. Starts just before the first trade by default; trades appear as their bars are reached |
| `w.chart()` | Back to the static chart |
| `w.goto("2025-03-14 10:30")` | Scroll there (Chart mode) or move the replay cursor (Replay mode) |
| `w.goto_trade(i)` | Jump to trade *i* |
| `w.play()` / `w.pause()` / `w.step(n)` | Replay transport from Python |
| `w.set_bars(df)` / `w.set_trades(t)` / `w.set_levels(l)` | Replace data or annotations |
| `w.theme = "light"` | Switch theme |

The toolbar has the same controls: Chart|Replay, ⏮ ▶/⏸ ▸|, speed, a scrubber, and
◀ trade ▶. With the chart focused, Space plays or pauses and → steps one bar.

### Inputs

- **Bars**: a DataFrame with a DatetimeIndex or a `ts`/`time`/`date` column, plus
  `open/high/low/close[/volume]` (any letter case). Naive datetimes are read as
  `naive_tz` (default `"UTC"`). Pass `naive_tz="Asia/Kolkata"` for IST-naive CSVs.
- **Trades**: backtesting.py's `stats["_trades"]` (`EntryTime, ExitTime, EntryPrice,
  ExitPrice, Size, SL, TP, Tag`), or generic records (`entry_time, exit_time, side,
  entry_price, exit_price, stop|sl, target|tp, label|tag`).
- **Levels**: `[{fromTs, toTs, price, color?, label?, dash?}]` in ms epoch, or use
  `prev_day_levels(bars)`.

All bars are sent to the browser once, but the chart starts with a single 7-day window and pages older and
newer weeks in only as you scroll. So ~150k 1m bars (≈7 MB on the wire) stay responsive. Trade
annotations appear only for loaded bars.

## Test

```bash
uv pip install -e "./python[dev]" && python -m pytest python/tests
```
