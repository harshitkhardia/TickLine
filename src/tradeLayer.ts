// TradeLayer — markers, position boxes and level lines over a v9 chart.
//
// v9 resolves an overlay point's timestamp to the NEAREST loaded bar, so an
// annotation whose bar isn't loaded would be drawn clamped to the data edge.
// The layer therefore only materializes annotations whose time lies inside the
// loaded data, and re-evaluates on every data change (`sync()`). That one rule
// gives chunked loading AND replay for free: in replay, a trade's entry marker,
// box and exit appear exactly when the replay reaches those bars.

import type { Chart, KLineData } from "klinecharts";
import type { Marker, TradePosition, LevelLine } from "./types";
import type { MarkerExt, PositionExt, LevelExt } from "./overlays"; // type-only: no runtime klinecharts
import { PROFIT, LOSS } from "./colors";

const GROUP = "__tickline_trade";

interface MarkerRec { m: Marker; oid: string | null; anchor?: number; }
interface PositionRec { p: TradePosition; oid: string | null; phase: "hidden" | "open" | "closed"; endTs: number; }
interface LevelRec { l: LevelLine; oid: string | null; }

/** Index of the last bar with timestamp <= ts (-1 if none). */
export function barIndexAtOrBefore(list: KLineData[], ts: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].timestamp <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export class TradeLayer {
  private markers: MarkerRec[] = [];
  private positions: PositionRec[] = [];
  private levels: LevelRec[] = [];

  constructor(private chart: Chart, private periodMs: () => number) {}

  setMarkers(marks: Marker[]): void {
    this.removeAll(this.markers);
    this.markers = [...marks].sort((a, b) => a.ts - b.ts).map((m) => ({ m, oid: null }));
    this.sync();
  }
  setPositions(ps: TradePosition[]): void {
    this.removeAll(this.positions);
    this.positions = ps.map((p) => ({ p, oid: null, phase: "hidden" as const, endTs: 0 }));
    this.sync();
  }
  setLevels(ls: LevelLine[]): void {
    this.removeAll(this.levels);
    this.levels = ls.map((l) => ({ l, oid: null }));
    this.sync();
  }
  clear(): void {
    this.chart.removeOverlay({ groupId: GROUP } as never);
    this.markers = []; this.positions = []; this.levels = [];
  }
  /** The engine dropped every overlay (e.g. removeOverlay() with no args): forget ids, re-create. */
  invalidate(): void {
    for (const r of this.markers) r.oid = null;
    for (const r of this.positions) { r.oid = null; r.phase = "hidden"; }
    for (const r of this.levels) r.oid = null;
    this.sync();
  }
  get counts(): { markers: number; positions: number; levels: number } {
    return { markers: this.markers.length, positions: this.positions.length, levels: this.levels.length };
  }

  private removeAll(recs: Array<{ oid: string | null }>): void {
    for (const r of recs) if (r.oid) this.chart.removeOverlay(r.oid);
  }
  private create(name: string, points: Array<{ timestamp: number; value: number }>, extendData: unknown): string | null {
    const id = this.chart.createOverlay({ name, groupId: GROUP, lock: true, points, extendData } as never);
    return (Array.isArray(id) ? id[0] : id) ?? null;
  }
  private precision(): number {
    try { return (this.chart as any).getPriceVolumePrecision?.()?.price ?? 2; } catch { return 2; }
  }

  /** Re-evaluate visibility against the currently loaded bars. Cheap; call after any data change. */
  sync(): void {
    if (!this.markers.length && !this.positions.length && !this.levels.length) return;
    const list = (this.chart.getDataList?.() ?? []) as KLineData[];
    if (!list.length) {
      for (const r of this.markers) if (r.oid) { this.chart.removeOverlay(r.oid); r.oid = null; }
      for (const r of this.positions) if (r.oid) { this.chart.removeOverlay(r.oid); r.oid = null; r.phase = "hidden"; }
      for (const r of this.levels) if (r.oid) { this.chart.removeOverlay(r.oid); r.oid = null; }
      return;
    }
    const first = list[0].timestamp;
    const last = list[list.length - 1].timestamp;
    const lastEnd = last + this.periodMs(); // the newest bar covers [last, last+period)
    this.syncMarkers(list, first, lastEnd);
    this.syncPositions(first, last, lastEnd);
    this.syncLevels(first, lastEnd);
  }

  private syncMarkers(list: KLineData[], first: number, lastEnd: number): void {
    const lastTs = list[list.length - 1].timestamp;
    const anchorOf = (m: Marker): number => {
      if (m.price != null) return m.price;
      const bar = list[barIndexAtOrBefore(list, m.ts)];
      return m.position === "aboveBar" ? bar.high : m.position === "belowBar" ? bar.low : bar.close;
    };
    for (const r of this.markers) {
      const { m } = r;
      const visible = m.ts >= first && m.ts < lastEnd;
      if (visible && !r.oid) {
        const anchor = anchorOf(m);
        const color = m.color ?? (m.shape === "arrowDown" ? LOSS : PROFIT);
        const ext: MarkerExt = { position: m.position, shape: m.shape, color, text: m.text };
        r.oid = this.create("tlMarker", [{ timestamp: m.ts, value: anchor }], ext);
        r.anchor = anchor;
      } else if (visible && r.oid && m.price == null && m.ts >= lastTs) {
        // On the forming bar, high/low/close still move: follow them.
        const anchor = anchorOf(m);
        if (anchor !== r.anchor) {
          this.chart.overrideOverlay({ id: r.oid, points: [{ timestamp: m.ts, value: anchor }] } as never);
          r.anchor = anchor;
        }
      } else if (!visible && r.oid) {
        this.chart.removeOverlay(r.oid); r.oid = null;
      }
    }
  }

  private syncPositions(first: number, last: number, lastEnd: number): void {
    for (const r of this.positions) {
      const { p } = r;
      const phase: PositionRec["phase"] =
        p.entryTs < first || p.entryTs >= lastEnd ? "hidden"
        : p.exitTs != null && p.exitTs < lastEnd ? "closed" : "open";
      const endTs = phase === "closed" ? p.exitTs! : last;
      if (phase === "hidden") {
        if (r.oid) { this.chart.removeOverlay(r.oid); r.oid = null; }
        r.phase = phase;
        continue;
      }
      if (r.oid && r.phase === phase && r.endTs === endTs) continue; // nothing moved
      const points = [
        { timestamp: p.entryTs, value: p.entryPrice },
        { timestamp: endTs, value: p.targetPrice ?? p.entryPrice },
        { timestamp: endTs, value: p.stopPrice ?? p.entryPrice },
      ];
      if (phase === "closed" && p.exitPrice != null) points.push({ timestamp: p.exitTs!, value: p.exitPrice });
      const ext: PositionExt = {
        side: p.side, entry: p.entryPrice, stop: p.stopPrice, target: p.targetPrice,
        exit: phase === "closed" ? p.exitPrice : undefined, closed: phase === "closed",
        label: p.label, precision: this.precision(),
      };
      if (r.oid) this.chart.overrideOverlay({ id: r.oid, points, extendData: ext } as never);
      else r.oid = this.create("tlPosition", points, ext);
      r.phase = phase;
      r.endTs = endTs;
    }
  }

  private syncLevels(first: number, lastEnd: number): void {
    for (const r of this.levels) {
      const { l } = r;
      const visible = l.fromTs < lastEnd && l.toTs >= first;
      if (visible && !r.oid) {
        const ext: LevelExt = { color: l.color ?? "#f59e0b", width: l.width ?? 1, dash: l.dash ?? true, label: l.label };
        r.oid = this.create("tlLevel", [{ timestamp: l.fromTs, value: l.price }, { timestamp: l.toTs, value: l.price }], ext);
      } else if (!visible && r.oid) {
        this.chart.removeOverlay(r.oid); r.oid = null;
      }
    }
  }
}
