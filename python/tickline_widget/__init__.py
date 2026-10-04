"""TickLine in Jupyter — a TradingView-style backtest chart widget (anywidget).

    from tickline_widget import TickLineChart, prev_day_levels

    w = TickLineChart(bars_df, trades=stats["_trades"], levels=prev_day_levels(bars_df),
                      title="NIFTY 1m · PDL sweep", timezone="Asia/Kolkata")
    w                      # static chart: candles, entry/exit arrows, TP/SL position boxes
    w.replay()             # bar replay from just before the first trade (▶ / speed / scrub)
    w.goto_trade(3)        # jump to the 4th trade

Works in JupyterLab, Jupyter Notebook 7 and VS Code notebooks. The front-end
(static/widget.js) is TickLine + KLineChart bundled — no npm or CDN needed at
runtime. Rebuild it from the TickLine repo with `npm run build`.

Timestamps: everything crosses to JS as ms-epoch UTC. Naive datetimes are
interpreted in `naive_tz` (default "UTC" — QuantPrime's DuckDB stores naive UTC).
"""
from __future__ import annotations

import math
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import anywidget
import numpy as np
import traitlets

__all__ = ["TickLineChart", "prev_day_levels", "trades_to_annotations", "bars_to_bytes", "to_ms"]
__version__ = "0.1.0"

_STATIC = Path(__file__).parent / "static"


# --------------------------------------------------------------------------- time
def to_ms(values: Any, naive_tz: str = "UTC") -> np.ndarray:
    """Convert timestamps (pandas/numpy datetimes, python datetimes, or epoch numbers)
    to an int64 array of ms-epoch UTC. Epoch numbers < 1e11 are taken as seconds."""
    try:
        import pandas as pd
    except ImportError:  # pragma: no cover - pandas is optional
        pd = None

    if pd is not None and not np.isscalar(values) and not isinstance(values, (datetime, date)):
        idx = pd.Index(values) if not isinstance(values, (pd.Index, pd.Series)) else values
        if isinstance(idx, pd.Series):
            idx = pd.Index(idx)
        if pd.api.types.is_datetime64_any_dtype(idx.dtype):
            dt = pd.DatetimeIndex(idx)
            if dt.tz is None:
                dt = dt.tz_localize(naive_tz)
            return (dt.tz_convert("UTC").as_unit("ns").asi8 // 1_000_000).astype(np.int64)
        if pd.api.types.is_object_dtype(idx.dtype) and len(idx) and isinstance(idx[0], (datetime, date, str)):
            return to_ms(pd.to_datetime(idx), naive_tz)
        arr = np.asarray(idx, dtype="float64")
    else:
        if isinstance(values, (datetime, date, str)):
            if pd is None:
                raise TypeError("pandas is required to convert datetime/str timestamps")
            return to_ms(pd.DatetimeIndex([pd.Timestamp(values)]), naive_tz)
        arr = np.atleast_1d(np.asarray(values, dtype="float64"))
    return np.where(arr < 1e11, arr * 1000.0, arr).astype(np.int64)


def _scalar_ms(value: Any, naive_tz: str = "UTC") -> int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        import pandas as pd
        if value is pd.NaT:
            return None
    except ImportError:  # pragma: no cover
        pass
    return int(to_ms([value] if not isinstance(value, (datetime, date, str)) else value, naive_tz)[0])


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


# --------------------------------------------------------------------------- bars
_COLS = {
    "ts": ("ts", "time", "timestamp", "datetime", "date"),
    "open": ("open", "o"), "high": ("high", "h"), "low": ("low", "l"), "close": ("close", "c"),
    "volume": ("volume", "vol", "v"),
}


def _pick(df: Any, names: Sequence[str]) -> Any | None:
    lower = {str(c).lower(): c for c in df.columns}
    for n in names:
        if n in lower:
            return df[lower[n]]
    return None


def bars_to_bytes(bars: Any, naive_tz: str = "UTC") -> bytes:
    """OHLCV -> the widget wire format: little-endian float64, column-major
    [ts…, open…, high…, low…, close…, volume…].

    Accepts a pandas DataFrame (DatetimeIndex or a ts/time/date column; column names
    case-insensitive, so backtesting.py's Open/High/Low/Close work) or a dict of arrays."""
    if isinstance(bars, dict):
        import pandas as pd
        bars = pd.DataFrame(bars)
    ts = _pick(bars, _COLS["ts"])
    ts_ms = to_ms(bars.index if ts is None else ts, naive_tz)
    cols = []
    for key in ("open", "high", "low", "close"):
        col = _pick(bars, _COLS[key])
        if col is None:
            raise ValueError(f"bars needs a '{key}' column (got {list(bars.columns)})")
        cols.append(np.asarray(col, dtype="<f8"))
    vol = _pick(bars, _COLS["volume"])
    cols.append(np.zeros(len(ts_ms), dtype="<f8") if vol is None else np.nan_to_num(np.asarray(vol, dtype="<f8")))
    mat = np.vstack([ts_ms.astype("<f8"), *cols])
    order = np.argsort(mat[0], kind="stable")
    return np.ascontiguousarray(mat[:, order]).tobytes()


# --------------------------------------------------------------------------- trades
def _records(trades: Any) -> list[dict]:
    if trades is None:
        return []
    if hasattr(trades, "to_dict"):
        return trades.reset_index(drop=False).to_dict("records") if _has_time_index(trades) else trades.to_dict("records")
    return [dict(t) for t in trades]


def _has_time_index(df: Any) -> bool:
    try:
        import pandas as pd
        return isinstance(df.index, pd.DatetimeIndex)
    except ImportError:  # pragma: no cover
        return False


def _get(rec: dict, *names: str) -> Any:
    lower = {str(k).lower().replace("_", ""): v for k, v in rec.items()}
    for n in names:
        v = lower.get(n.lower().replace("_", ""))
        if v is not None:
            return v
    return None


def _side(rec: dict) -> str:
    side = _get(rec, "side", "direction", "type")
    if isinstance(side, str):
        return "short" if side.strip().lower() in ("short", "sell", "s", "-1") else "long"
    size = _num(_get(rec, "size", "qty", "quantity"))
    if size is not None:
        return "short" if size < 0 else "long"
    return "long" if side is None or float(side) >= 0 else "short"


def trades_to_annotations(trades: Any, naive_tz: str = "UTC", label_col: str | None = None) -> tuple[list[dict], list[dict]]:
    """Trade log -> (markers, positions) for the chart.

    Understands backtesting.py's ``stats["_trades"]`` (EntryTime/ExitTime/EntryPrice/
    ExitPrice/Size/SL/TP/Tag) and a generic shape (entry_time, exit_time, side,
    entry_price, exit_price, stop|sl, target|tp, label|tag)."""
    markers: list[dict] = []
    positions: list[dict] = []
    for i, rec in enumerate(_records(trades)):
        entry_ts = _scalar_ms(_get(rec, "entry_time", "entrytime", "entry_ts", "entry"), naive_tz)
        entry_px = _num(_get(rec, "entry_price", "entryprice"))
        if entry_ts is None or entry_px is None:
            continue
        side = _side(rec)
        exit_ts = _scalar_ms(_get(rec, "exit_time", "exittime", "exit_ts"), naive_tz)
        exit_px = _num(_get(rec, "exit_price", "exitprice"))
        stop = _num(_get(rec, "stop", "sl", "stop_loss", "stoploss"))
        target = _num(_get(rec, "target", "tp", "take_profit", "takeprofit"))
        label = _get(rec, label_col) if label_col else _get(rec, "label", "tag")
        long = side == "long"

        pos: dict = {"id": f"t{i}", "side": side, "entryTs": entry_ts, "entryPrice": entry_px}
        if stop is not None:
            pos["stopPrice"] = stop
        if target is not None:
            pos["targetPrice"] = target
        if exit_ts is not None and exit_px is not None:
            pos["exitTs"], pos["exitPrice"] = exit_ts, exit_px
        if label is not None and str(label) not in ("", "nan", "None"):
            pos["label"] = str(label)
        positions.append(pos)

        markers.append({"ts": entry_ts, "position": "belowBar" if long else "aboveBar",
                        "shape": "arrowUp" if long else "arrowDown", "text": "Buy" if long else "Sell"})
        if exit_ts is not None and exit_px is not None:
            pnl = (exit_px - entry_px) if long else (entry_px - exit_px)
            markers.append({"ts": exit_ts, "position": "aboveBar" if long else "belowBar",
                            "shape": "arrowDown" if long else "arrowUp", "text": "Exit",
                            "color": "#26a69a" if pnl >= 0 else "#ef5350"})
    return markers, positions


# --------------------------------------------------------------------------- levels
def prev_day_levels(bars: Any, session_tz: str = "Asia/Kolkata", naive_tz: str = "UTC",
                    high_color: str = "#f59e0b", low_color: str = "#38bdf8") -> list[dict]:
    """Previous-day high/low (PDH/PDL) drawn across each following session.

    Days are split in ``session_tz`` (IST for NSE), so a UTC-stored 1m series groups
    into the right trading days."""
    import pandas as pd

    raw = np.frombuffer(bars_to_bytes(bars, naive_tz), dtype="<f8")
    n = raw.size // 6
    ts = pd.to_datetime(raw[:n].astype(np.int64), unit="ms", utc=True).tz_convert(session_tz)
    df = pd.DataFrame({"ts": raw[:n].astype(np.int64), "high": raw[2 * n:3 * n], "low": raw[3 * n:4 * n]}, index=ts)
    days = df.groupby(df.index.date).agg(high=("high", "max"), low=("low", "min"), start=("ts", "min"), end=("ts", "max"))
    levels: list[dict] = []
    for prev, cur in zip(days.itertuples(), list(days.itertuples())[1:]):
        span = {"fromTs": int(cur.start), "toTs": int(cur.end)}
        levels.append({**span, "id": f"pdh{cur.Index}", "price": float(prev.high), "color": high_color, "label": "PDH", "dash": True})
        levels.append({**span, "id": f"pdl{cur.Index}", "price": float(prev.low), "color": low_color, "label": "PDL", "dash": True})
    return levels


# --------------------------------------------------------------------------- widget
class TickLineChart(anywidget.AnyWidget):
    """TickLine backtest chart. See the module docstring for a walkthrough."""

    _esm = _STATIC / "widget.js"

    _bars = traitlets.Bytes(b"").tag(sync=True)
    markers = traitlets.List([]).tag(sync=True)
    positions = traitlets.List([]).tag(sync=True)
    levels = traitlets.List([]).tag(sync=True)
    symbol = traitlets.Unicode("SYMBOL").tag(sync=True)
    period = traitlets.Unicode("1m").tag(sync=True)
    title = traitlets.Unicode("").tag(sync=True)
    theme = traitlets.Enum(["dark", "light"], default_value="dark").tag(sync=True)
    timezone = traitlets.Unicode("UTC").tag(sync=True)
    height = traitlets.Int(520).tag(sync=True)
    precision = traitlets.Int(2).tag(sync=True)
    mode = traitlets.Enum(["chart", "replay"], default_value="chart").tag(sync=True)
    speed = traitlets.Float(10.0).tag(sync=True)

    def __init__(self, bars: Any = None, *, trades: Any = None, markers: Iterable[dict] | None = None,
                 positions: Iterable[dict] | None = None, levels: Iterable[dict] | None = None,
                 naive_tz: str = "UTC", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._naive_tz = naive_tz
        if bars is not None:
            self.set_bars(bars)
        if trades is not None:
            self.set_trades(trades)
        if markers is not None:
            self.markers = list(markers)
        if positions is not None:
            self.positions = list(positions)
        if levels is not None:
            self.levels = list(levels)

    # data
    def set_bars(self, bars: Any) -> "TickLineChart":
        self._bars = bars_to_bytes(bars, self._naive_tz)
        return self

    def set_trades(self, trades: Any, label_col: str | None = None) -> "TickLineChart":
        """Replace markers + position boxes from a trade log (backtesting.py or generic)."""
        self.markers, self.positions = trades_to_annotations(trades, self._naive_tz, label_col)
        return self

    def set_levels(self, levels: Iterable[dict]) -> "TickLineChart":
        self.levels = list(levels)
        return self

    @property
    def bar_count(self) -> int:
        return len(self._bars) // 48

    # navigation
    def goto(self, when: Any) -> None:
        """Scroll to a time (Chart mode) or move the replay cursor there (Replay mode)."""
        self.send({"type": "goto", "ts": _scalar_ms(when, self._naive_tz)})

    def goto_trade(self, index: int) -> None:
        self.send({"type": "goto_trade", "index": int(index)})

    # replay
    def replay(self, start: Any = None, speed: float | None = None) -> "TickLineChart":
        """Switch to bar replay. ``start``: a time (default: just before the first trade)."""
        if speed is not None:
            self.speed = float(speed)
        self.mode = "replay"
        if start is not None:
            self.send({"type": "seek", "ts": _scalar_ms(start, self._naive_tz)})
        return self

    def chart(self) -> "TickLineChart":
        """Back to the static chart."""
        self.mode = "chart"
        return self

    def play(self) -> None:
        self.send({"type": "play"})

    def pause(self) -> None:
        self.send({"type": "pause"})

    def step(self, n: int = 1) -> None:
        self.send({"type": "step", "n": int(n)})
