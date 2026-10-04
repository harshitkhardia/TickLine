// Jupyter front-end for the `tickline_widget` Python package (anywidget ESM).
// Bundled WITH klinecharts into python/tickline_widget/static/widget.js, so the
// notebook needs no npm/CDN. Mounts a BacktestView and maps synced traits +
// custom messages onto it.
//
// Wire format (kept in step with python/tickline_widget/__init__.py):
//   _bars      bytes: little-endian float64, column-major [ts…, open…, high…, low…, close…, volume…]
//   markers / positions / levels: lists of dicts in TickLine's TS shapes (ms-epoch timestamps)
//   msg {type:"goto", ts} | {type:"goto_trade", index} | {type:"mode", mode} | {type:"seek", ts}
//       | {type:"play"} | {type:"pause"} | {type:"step", n}

import { BacktestView } from "../src/index"; // index registers the custom overlays
import type { Bar, Marker, TradePosition, LevelLine } from "../src/types";

interface Model {
  get(name: string): any;
  on(event: string, cb: (...args: any[]) => void): void;
  off(event?: string | null, cb?: ((...args: any[]) => void) | null): void;
}

export function decodeBars(dv: DataView | ArrayBuffer | null | undefined): Bar[] {
  if (!dv || dv.byteLength === 0) return [];
  const view = dv instanceof DataView ? dv : new DataView(dv);
  // copy into an aligned buffer (the incoming view may sit at any byte offset)
  const f = new Float64Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  const n = f.length / 6;
  const bars: Bar[] = new Array(n);
  for (let i = 0; i < n; i++) {
    bars[i] = { ts: f[i], open: f[n + i], high: f[2 * n + i], low: f[3 * n + i], close: f[4 * n + i], volume: f[5 * n + i] };
  }
  return bars;
}

function render({ model, el }: { model: Model; el: HTMLElement }): () => void {
  const view = new BacktestView(el, {
    bars: decodeBars(model.get("_bars")),
    symbol: model.get("symbol") || "SYMBOL",
    period: model.get("period") || "1m",
    title: model.get("title") || undefined,
    theme: model.get("theme") === "light" ? "light" : "dark",
    timezone: model.get("timezone") || "UTC",
    height: model.get("height") || 520,
    precision: model.get("precision") ?? 2,
    speed: model.get("speed") || 10,
    mode: model.get("mode") === "replay" ? "replay" : "chart",
    markers: (model.get("markers") ?? []) as Marker[],
    positions: (model.get("positions") ?? []) as TradePosition[],
    levels: (model.get("levels") ?? []) as LevelLine[],
  });

  const handlers: Array<[string, (...a: any[]) => void]> = [
    ["change:_bars", () => view.setBars(decodeBars(model.get("_bars")))],
    ["change:markers", () => view.setAnnotations({ markers: model.get("markers") ?? [] })],
    ["change:positions", () => view.setAnnotations({ positions: model.get("positions") ?? [] })],
    ["change:levels", () => view.setAnnotations({ levels: model.get("levels") ?? [] })],
    ["change:theme", () => view.setTheme(model.get("theme") === "light" ? "light" : "dark")],
    ["change:mode", () => void view.setMode(model.get("mode") === "replay" ? "replay" : "chart")],
    ["change:speed", () => view.setSpeed(model.get("speed") || 10)],
    ["msg:custom", (msg: any) => {
      switch (msg?.type) {
        case "goto": void view.goto(msg.ts); break;
        case "goto_trade": void view.gotoTrade(msg.index); break;
        case "seek": view.replayFeed?.seek(msg.ts); break;
        case "play": view.replayFeed?.play(); break;
        case "pause": view.replayFeed?.pause(); break;
        case "step": view.replayFeed?.step(msg.n ?? 1); break;
      }
    }],
  ];
  for (const [ev, cb] of handlers) model.on(ev, cb);

  return () => {
    for (const [ev, cb] of handlers) model.off(ev, cb);
    view.dispose();
  };
}

export default { render };
