// QuantPrimeDatafeed — TickLine `Datafeed` adapter over the QP backend.
//
// Hits the live QuantPrime backend (BrokerSimulator today, real broker later):
//   backfill: GET  /api/history?token=&tf=&days=   -> { bars:[{ts,ohlcv,oi}], count, mock }
//   live:     WS   /ws/ticks?tokens=               -> { type:"tick", quotes:{ token:{ltp,...} } }
//
// The WS emits QUOTE SNAPSHOTS, not bars — so we aggregate tick->bar here via
// TickLine's BarBuilder (exactly the kb/ARCHITECTURE.md §2 path for QP).
//
// Four QP-contract gotchas handled here (see qp-shared.ts + below):
//  1. ts is naive-UTC ISO -> parseTs appends "Z".
//  2. endpoints take token:int -> resolveToken maps symbol->token.
//  3. WS emits quotes not bars -> BarBuilder aggregates.
//  4. tf codes are lowercase; unsupported Periods silently fall back to 5m
//     server-side, so we restrict the Period set in main.ts.

import type { Datafeed } from "tickline";
import { BarBuilder, type Bar, type Period, type SessionSpec, type Unsubscribe } from "tickline";
import { parseTs, resolveToken } from "./qp-shared";

const BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

// QP's DuckDB aggregation anchors candles at the NSE open (origin offset 225 min =
// 09:15 IST), so live bars must bucket the same way or they won't merge with /history.
const NSE_SESSION: SessionSpec = { tz: "Asia/Kolkata", sessions: [{ start: "09:15", end: "15:30" }] };

interface QpBarWire {
  ts: string;
  open: number; high: number; low: number; close: number;
  volume: number; oi?: number;
}
interface HistoryResponse { bars: QpBarWire[]; count: number; mock: boolean; note?: string }
interface QuoteWire {
  instrument_token: number; ltp: number; bid: number; ask: number;
  volume: number; ts: string; oi?: number;
}

function toBar(b: QpBarWire): Bar {
  return {
    ts: parseTs(b.ts),
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  };
}

export interface QpDatafeedOptions {
  /** Called once with the backend's `mock` flag so the UI can show a badge. */
  onMockFlag?: (mock: boolean) => void;
}

export function createQuantPrimeDatafeed(opts: QpDatafeedOptions = {}): Datafeed {
  return {
    async getBars(symbol: string, period: Period, from: number, to: number): Promise<Bar[]> {
      const token = resolveToken(symbol);
      const days = Math.max(1, Math.ceil((to - from) / 86_400_000));
      const url = `${BASE}/api/history?token=${token}&tf=${encodeURIComponent(period)}&days=${days}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`QP /history ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as HistoryResponse;
      opts.onMockFlag?.(json.mock);
      return json.bars.map(toBar);
    },

    subscribe(symbol: string, period: Period, onBar: (bar: Bar) => void): Unsubscribe {
      const token = resolveToken(symbol);
      const builder = new BarBuilder(period, { session: NSE_SESSION });
      const wsUrl = `${WS_BASE}/ws/ticks?tokens=${token}`;
      let ws: WebSocket | null = null;
      let closed = false;
      const reconnect = () => {
        if (closed) return;
        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          let frame: any;
          try { frame = JSON.parse(ev.data); } catch { return; }
          if (frame?.type !== "tick") return;
          const q: QuoteWire | undefined = frame.quotes?.[String(token)];
          if (!q) return;
          const bar = builder.push({ ts: parseTs(q.ts), price: q.ltp, volume: q.volume });
          onBar(bar);
        };
        ws.onclose = () => { if (!closed) setTimeout(reconnect, 1500); };
        ws.onerror = () => { ws?.close(); };
      };
      reconnect();
      return () => { closed = true; ws?.close(); };
    },
  };
}
