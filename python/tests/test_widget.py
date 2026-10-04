import numpy as np
import pandas as pd
import pytest

from tickline_widget import TickLineChart, bars_to_bytes, prev_day_levels, to_ms, trades_to_annotations

T0 = pd.Timestamp("2025-01-06 03:45")  # naive UTC == 09:15 IST
T0_MS = int(pd.Timestamp("2025-01-06 03:45", tz="UTC").value // 1_000_000)


def bars(n=5, start=T0, freq="1min"):
    idx = pd.date_range(start, periods=n, freq=freq)
    base = np.arange(n, dtype=float)
    return pd.DataFrame({"Open": 100 + base, "High": 102 + base, "Low": 98 + base, "Close": 101 + base}, index=idx)


def decode(b):
    f = np.frombuffer(b, dtype="<f8")
    return f.reshape(6, -1)


def test_to_ms_naive_aware_and_epoch():
    assert to_ms(pd.DatetimeIndex([T0]))[0] == T0_MS
    assert to_ms(pd.DatetimeIndex([pd.Timestamp("2025-01-06 09:15")]), naive_tz="Asia/Kolkata")[0] == T0_MS
    assert to_ms(pd.DatetimeIndex([pd.Timestamp("2025-01-06 09:15", tz="Asia/Kolkata")]))[0] == T0_MS
    assert to_ms([T0_MS / 1000])[0] == T0_MS  # seconds -> ms
    assert to_ms([T0_MS])[0] == T0_MS


def test_bars_to_bytes_column_major_sorted_and_volume_default():
    df = bars(3).iloc[::-1]  # reversed on purpose
    m = decode(bars_to_bytes(df))
    assert m.shape == (6, 3)
    assert list(m[0]) == [T0_MS, T0_MS + 60_000, T0_MS + 120_000]
    assert list(m[1]) == [100, 101, 102]  # open follows the sort
    assert list(m[5]) == [0, 0, 0]


def test_bars_to_bytes_ts_column_and_missing_ohlc():
    df = bars(2).reset_index().rename(columns={"index": "ts"})
    assert decode(bars_to_bytes(df))[0][0] == T0_MS
    with pytest.raises(ValueError):
        bars_to_bytes(df.drop(columns=["Close"]))


def test_trades_backtesting_py_shape():
    trades = pd.DataFrame([
        {"Size": 25, "EntryTime": T0, "ExitTime": T0 + pd.Timedelta(minutes=3), "EntryPrice": 100.0,
         "ExitPrice": 110.0, "SL": 95.0, "TP": 110.0, "Tag": "PDL sweep"},
        {"Size": -25, "EntryTime": T0 + pd.Timedelta(minutes=10), "ExitTime": pd.NaT, "EntryPrice": 120.0,
         "ExitPrice": np.nan, "SL": np.nan, "TP": np.nan, "Tag": None},
    ])
    markers, positions = trades_to_annotations(trades)
    assert positions[0] == {"id": "t0", "side": "long", "entryTs": T0_MS, "entryPrice": 100.0, "stopPrice": 95.0,
                            "targetPrice": 110.0, "exitTs": T0_MS + 180_000, "exitPrice": 110.0, "label": "PDL sweep"}
    assert positions[1] == {"id": "t1", "side": "short", "entryTs": T0_MS + 600_000, "entryPrice": 120.0}
    assert [m["shape"] for m in markers] == ["arrowUp", "arrowDown", "arrowDown"]
    assert markers[1]["color"] == "#26a69a"  # winning exit


def test_trades_generic_shape():
    _, positions = trades_to_annotations([
        {"side": "sell", "entry_time": T0, "entry_price": 50, "exit_time": T0, "exit_price": 49, "stop": 51, "target": 48},
    ])
    assert positions[0]["side"] == "short" and positions[0]["stopPrice"] == 51


def test_prev_day_levels_split_in_ist():
    # two IST sessions, 3 bars each
    d1 = bars(3, start=pd.Timestamp("2025-01-06 03:45"))
    d2 = bars(3, start=pd.Timestamp("2025-01-07 03:45")) + 10
    levels = prev_day_levels(pd.concat([d1, d2]))
    assert [(l["label"], l["price"]) for l in levels] == [("PDH", 104.0), ("PDL", 98.0)]
    assert levels[0]["fromTs"] == int(pd.Timestamp("2025-01-07 03:45", tz="UTC").value // 1_000_000)


def test_widget_traits():
    w = TickLineChart(bars(4), trades=[{"side": "long", "entry_time": T0, "entry_price": 100}], title="t")
    assert w.bar_count == 4
    assert len(w.positions) == 1 and len(w.markers) == 1
    assert w._esm.exists() if hasattr(w._esm, "exists") else True
    w.replay(speed=50)
    assert w.mode == "replay" and w.speed == 50
