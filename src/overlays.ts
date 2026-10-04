// Custom overlay tools that KLineChart v9 does NOT ship as overlays (only as
// figures). Registered once at library load so `draw("rect")` etc. work.
// kb/KLINECHART_MAPPING.md assumed `rect -> rect` was native; it is not —
// `rect` exists only as a draw primitive (figure), not as an interactive
// overlay. We register a 2-point bounding-box overlay that uses that figure.
//
// Also registers the non-interactive trade-annotation overlays driven by
// tradeLayer.ts: `tlMarker` (setMarkers), `tlPosition` (setPositions),
// `tlLevel` (setLevels). Their per-instance data rides in `extendData`.
//
// Idempotent + non-clobbering: skips any name a consumer already registered.

import { registerOverlay, getSupportedOverlays } from "klinecharts";
import { PROFIT_FILL, LOSS_FILL, PROFIT, LOSS } from "./colors";

let registered = false;

type Coord = { x: number; y: number };
type Fig = { type: string; attrs: unknown; styles?: Record<string, unknown>; ignoreEvent?: boolean };


/** A label figure: plain coloured text, or a filled chip when `bg` is given. */
function text(x: number, y: number, t: string, color: string, align: CanvasTextAlign, baseline: CanvasTextBaseline, bg?: string): Fig {
  return {
    type: "text",
    attrs: { x, y, text: t, align, baseline },
    styles: {
      style: "fill", color, size: 11, weight: "normal", family: "ui-monospace, Menlo, Consolas, monospace",
      backgroundColor: bg ?? "transparent", borderSize: 0, borderRadius: 2,
      paddingLeft: bg ? 4 : 0, paddingRight: bg ? 4 : 0, paddingTop: bg ? 2 : 0, paddingBottom: bg ? 2 : 0,
    },
    ignoreEvent: true,
  };
}

export interface MarkerExt { position: "aboveBar" | "belowBar" | "inBar"; shape: string; color: string; text?: string; }

/** Marker glyph around a centre derived from the anchor + position (pure; unit-tested). */
export function markerFigures(anchor: Coord, ext: MarkerExt): Fig[] {
  const size = 6, gap = 6;
  const { x, y } = anchor;
  const cy = ext.position === "belowBar" ? y + gap + size : ext.position === "aboveBar" ? y - gap - size : y;
  const fill = { style: "fill", color: ext.color };
  const figs: Fig[] = [];
  if (ext.shape === "arrowUp") {
    figs.push({ type: "polygon", attrs: { coordinates: [{ x, y: cy - size }, { x: x - size, y: cy + size }, { x: x + size, y: cy + size }] }, styles: fill, ignoreEvent: true });
  } else if (ext.shape === "arrowDown") {
    figs.push({ type: "polygon", attrs: { coordinates: [{ x, y: cy + size }, { x: x - size, y: cy - size }, { x: x + size, y: cy - size }] }, styles: fill, ignoreEvent: true });
  } else if (ext.shape === "circle") {
    figs.push({ type: "circle", attrs: { x, y: cy, r: size - 1 }, styles: fill, ignoreEvent: true });
  } else {
    figs.push({ type: "rect", attrs: { x: x - size + 1, y: cy - size + 1, width: 2 * size - 2, height: 2 * size - 2 }, styles: fill, ignoreEvent: true });
  }
  if (ext.text) {
    figs.push(ext.position === "belowBar"
      ? text(x, cy + size + 3, ext.text, ext.color, "center", "top")
      : text(x, cy - size - 3, ext.text, ext.color, "center", "bottom"));
  }
  return figs;
}

export interface PositionExt {
  side: "long" | "short"; entry: number; stop?: number; target?: number; exit?: number;
  closed: boolean; label?: string; precision: number;
}

/** R-multiple + price P&L of a closed trade (null when there is no stop to size R). */
export function tradeResult(ext: Pick<PositionExt, "side" | "entry" | "stop" | "exit">): { pnl: number; r: number | null } | null {
  if (ext.exit == null) return null;
  const pnl = ext.side === "long" ? ext.exit - ext.entry : ext.entry - ext.exit;
  const risk = ext.stop != null ? Math.abs(ext.entry - ext.stop) : 0;
  return { pnl, r: risk > 0 ? pnl / risk : null };
}

/** Position box figures. coords = [entry, end@target, end@stop, exit?] (pure; unit-tested). */
export function positionFigures(coords: Coord[], ext: PositionExt, minWidth = 12): Fig[] {
  const [e, t, s, x] = coords;
  if (!e || !t || !s) return [];
  const x0 = e.x;
  const x1 = Math.max(t.x, x0 + minWidth);
  const w = x1 - x0;
  const p = (v: number) => v.toFixed(ext.precision);
  const figs: Fig[] = [];
  if (ext.target != null) {
    figs.push({ type: "rect", attrs: { x: x0, y: Math.min(e.y, t.y), width: w, height: Math.abs(t.y - e.y) }, styles: { style: "fill", color: PROFIT_FILL }, ignoreEvent: true });
    figs.push(text(x1 - 2, t.y + (t.y < e.y ? 2 : -2), `TP ${p(ext.target)}`, PROFIT, "right", t.y < e.y ? "top" : "bottom"));
  }
  if (ext.stop != null) {
    figs.push({ type: "rect", attrs: { x: x0, y: Math.min(e.y, s.y), width: w, height: Math.abs(s.y - e.y) }, styles: { style: "fill", color: LOSS_FILL }, ignoreEvent: true });
    figs.push(text(x1 - 2, s.y + (s.y > e.y ? -2 : 2), `SL ${p(ext.stop)}`, LOSS, "right", s.y > e.y ? "bottom" : "top"));
  }
  figs.push({ type: "line", attrs: { coordinates: [{ x: x0, y: e.y }, { x: x1, y: e.y }] }, styles: { style: "solid", color: "#9ca3af", size: 1 }, ignoreEvent: true });
  const head = `${ext.side === "long" ? "▲ LONG" : "▼ SHORT"} ${p(ext.entry)}${ext.label ? " · " + ext.label : ""}`;
  // header sits just inside the profit side of the entry line (above for long, below for short)
  const long = ext.side === "long";
  figs.push(text(x0 + 2, e.y + (long ? -2 : 2), head, "#a1a1aa", "left", long ? "bottom" : "top"));
  const res = ext.closed ? tradeResult(ext) : null;
  if (res && x) {
    const color = res.pnl >= 0 ? PROFIT : LOSS;
    figs.push({ type: "line", attrs: { coordinates: [{ x: x0, y: e.y }, { x: x.x, y: x.y }] }, styles: { style: "dashed", color, size: 1, dashedValue: [4, 3] }, ignoreEvent: true });
    figs.push({ type: "circle", attrs: { x: x.x, y: x.y, r: 3 }, styles: { style: "fill", color }, ignoreEvent: true });
    const sign = res.pnl >= 0 ? "+" : "";
    const label = res.r != null ? `${sign}${res.r.toFixed(2)}R (${sign}${p(res.pnl)})` : `${sign}${p(res.pnl)}`;
    figs.push(text(x.x + 6, x.y, label, "#ffffff", "left", "middle", color));
  }
  return figs;
}

export interface LevelExt { color: string; width: number; dash: boolean; label?: string; }

export function levelFigures(coords: Coord[], ext: LevelExt): Fig[] {
  const [a, b] = coords;
  if (!a || !b) return [];
  const figs: Fig[] = [{
    type: "line", attrs: { coordinates: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }] },
    styles: { style: ext.dash ? "dashed" : "solid", color: ext.color, size: ext.width, dashedValue: [6, 4] }, ignoreEvent: true,
  }];
  if (ext.label) figs.push(text(b.x - 2, a.y - 2, ext.label, ext.color, "right", "bottom"));
  return figs;
}

type FigParams = { coordinates: Coord[]; overlay: { extendData?: unknown } };

export function registerBuiltinOverlays(): void {
  if (registered) return;
  registered = true;

  const existing = new Set(getSupportedOverlays());

  // Rectangle / box — 2 points -> filled+stroked bounding box (the v9 `rect` figure).
  if (!existing.has("rect")) {
    registerOverlay({
      name: "rect",
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates }: { coordinates: Array<{ x: number; y: number }> }) => {
        if (coordinates.length < 2) return [];
        const [a, b] = coordinates;
        return [{
          type: "rect",
          attrs: {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.abs(a.x - b.x),
            height: Math.abs(a.y - b.y),
          },
        }];
      },
    } as never);
  }

  // Trade annotations — programmatic only (lock:true at create, no point handles).
  const annotation = (name: string, totalStep: number, build: (p: FigParams) => Fig[]) => {
    if (existing.has(name)) return;
    registerOverlay({
      name, totalStep,
      needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
      createPointFigures: (p: FigParams) => build(p),
    } as never);
  };
  annotation("tlMarker", 2, ({ coordinates, overlay }) =>
    coordinates[0] ? markerFigures(coordinates[0], overlay.extendData as MarkerExt) : []);
  annotation("tlPosition", 5, ({ coordinates, overlay }) =>
    positionFigures(coordinates, overlay.extendData as PositionExt));
  annotation("tlLevel", 3, ({ coordinates, overlay }) =>
    levelFigures(coordinates, overlay.extendData as LevelExt));
}
