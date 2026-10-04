// SyncController — multi-chart link groups (kb/CHARTMANAGER.md §5, kb/ARCHITECTURE.md §6).
// Browser-side; timestamp-keyed; window (not zoom); echo-suppressed.
//
// It owns the EVENT-DRIVEN sync dimensions:
//   • crosshair  — linked cursor, SYMBOL-scoped
//   • drawings   — replicate create/modify/remove, SYMBOL-scoped, id-mapped
//   • time       — click → scroll the ts into frame on every chart (whole layout)
//   • dateRange  — identical visible window on every chart (whole layout)
//
// symbol / interval / indicators are COMMAND fan-outs owned by ChartManager
// (no ChartController events exist for them), so they are not wired here.

import type { ChartController } from "./ChartController";
import type { SyncConfig, DrawTool, Point, Unsubscribe } from "./types";

type Dim = keyof SyncConfig;

// A drawing that exists on ≥1 chart; peers maps each chart to its overlay id there.
interface LogicalDrawing { tool: DrawTool; peers: Map<ChartController, string>; }

export class SyncController {
  private groups = new Map<string, Set<ChartController>>();
  private groupOf = new Map<ChartController, string>();
  private config = new Map<ChartController, SyncConfig>();
  private unsubs = new Map<ChartController, Unsubscribe[]>();

  private drawings: LogicalDrawing[] = [];
  private applying = false;                 // echo guard for synchronous replays
  private suppressed = new Set<ChartController>(); // echo guard for async (range) replays

  add(chart: ChartController, groupId: string): void {
    if (this.groupOf.has(chart)) this.remove(chart);
    let set = this.groups.get(groupId);
    if (!set) { set = new Set(); this.groups.set(groupId, set); }
    set.add(chart);
    this.groupOf.set(chart, groupId);
    this.wire(chart);
  }

  remove(chart: ChartController): void {
    const g = this.groupOf.get(chart);
    if (g) this.groups.get(g)?.delete(chart);
    this.groupOf.delete(chart);
    this.config.delete(chart);
    this.unsubs.get(chart)?.forEach((u) => u());
    this.unsubs.delete(chart);
    // forget this chart's overlays from every logical drawing
    for (const d of this.drawings) d.peers.delete(chart);
    this.drawings = this.drawings.filter((d) => d.peers.size > 0);
  }

  setConfig(chart: ChartController, cfg: SyncConfig): void { this.config.set(chart, cfg); }

  // ---- listener wiring ------------------------------------------------------
  private wire(chart: ChartController): void {
    const offs: Unsubscribe[] = [
      chart.on("crosshairMove", (e) => this.onCrosshair(chart, e)),
      chart.on("click", (e) => this.onClick(chart, e)),
      chart.on("visibleRangeChange", (e) => this.onRange(chart, e)),
      chart.on("drawingCreated", (e) => this.onDrawCreated(chart, e)),
      chart.on("drawingModified", (e) => this.onDrawModified(chart, e)),
      chart.on("drawingRemoved", (e) => this.onDrawRemoved(chart, e)),
    ];
    this.unsubs.set(chart, offs);
  }

  // ---- peer selection -------------------------------------------------------
  /** Other charts in the same group that have `dim` enabled; `sameSymbol` restricts
   *  to the source chart's symbol (crosshair/drawings are symbol-scoped). */
  private peers(chart: ChartController, dim: Dim, sameSymbol: boolean): ChartController[] {
    const g = this.groupOf.get(chart);
    if (!g || this.config.get(chart)?.[dim] !== true) return [];
    const out: ChartController[] = [];
    for (const c of this.groups.get(g) ?? []) {
      if (c === chart) continue;
      if (this.config.get(c)?.[dim] !== true) continue;
      if (sameSymbol && c.symbolId !== chart.symbolId) continue;
      out.push(c);
    }
    return out;
  }

  // ---- crosshair (symbol-scoped) --------------------------------------------
  private onCrosshair(chart: ChartController, e: { ts: number; value: number }): void {
    if (this.applying) return;
    for (const c of this.peers(chart, "crosshair", true)) {
      if (e.ts) c.setCrosshair(e.ts, e.value); else c.clearCrosshair();
    }
  }

  // ---- time: click → scroll into frame (whole layout) -----------------------
  private onClick(chart: ChartController, e: { ts: number; value: number }): void {
    if (this.applying || !e.ts) return;
    for (const c of this.peers(chart, "time", false)) {
      c.scrollTo(e.ts);
      c.setCrosshair(e.ts, e.value);
    }
  }

  // ---- dateRange: identical window (whole layout, echo-suppressed) ----------
  // v9 fires OnVisibleRangeChange synchronously inside setBarSpace/scrollByDistance,
  // so a guard held for the duration of the call catches the echo — no timer needed
  // (a fixed delay either expired too early on slow renders or swallowed real pans).
  private onRange(chart: ChartController, e: { from: number; to: number }): void {
    if (this.applying || this.suppressed.has(chart)) return;
    for (const c of this.peers(chart, "dateRange", false)) {
      this.suppressed.add(c);
      try { c.setVisibleRange(e.from, e.to); } finally { this.suppressed.delete(c); }
    }
  }

  // ---- drawings (symbol-scoped, id-mapped, sync echo-suppressed) -------------
  private find(chart: ChartController, id: string): LogicalDrawing | undefined {
    return this.drawings.find((d) => d.peers.get(chart) === id);
  }
  private onDrawCreated(chart: ChartController, e: { id: string; tool: DrawTool; points: Point[] }): void {
    if (this.applying) return;
    if (this.find(chart, e.id)) return;
    const ld: LogicalDrawing = { tool: e.tool, peers: new Map([[chart, e.id]]) };
    this.drawings.push(ld);
    this.applying = true;
    for (const c of this.peers(chart, "drawings", true)) {
      const sid = c.draw(e.tool, e.points);
      if (sid) ld.peers.set(c, sid);
    }
    this.applying = false;
  }
  private onDrawModified(chart: ChartController, e: { id: string; points: Point[] }): void {
    if (this.applying) return;
    const ld = this.find(chart, e.id);
    if (!ld) return;
    this.applying = true;
    for (const [c, oid] of ld.peers) if (c !== chart) c.updateDrawing(oid, e.points);
    this.applying = false;
  }
  private onDrawRemoved(chart: ChartController, e: { id: string }): void {
    if (this.applying) return;
    const ld = this.find(chart, e.id);
    if (!ld) return;
    this.applying = true;
    for (const [c, oid] of ld.peers) if (c !== chart) c.removeDrawing(oid);
    this.applying = false;
    this.drawings = this.drawings.filter((d) => d !== ld);
  }
}
