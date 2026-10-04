// ChartManager — drives a grid of charts (kb/CHARTMANAGER.md §6). One instance owns
// N ChartControllers, a SharedDatafeed (dedup + derive-from-base), and a
// SyncController (crosshair/drawings/time/dateRange). It adds the COMMAND-fan-out
// sync dimensions on top: symbol, interval, indicators.
//
// The host owns the DOM grid (which element each chart mounts in); ChartManager
// owns the charts, their data feed, and their synchronization.

import { createChart, ChartController } from "./ChartController";
import { SyncController } from "./SyncController";
import { createSharedDatafeed } from "./SharedDatafeed";
import type { Datafeed, SeriesSource, Storage } from "./adapters";
import type {
  Period, SyncConfig, Theme, SessionSpec, BuiltinIndicator, PaneId, IndicatorId,
  GridSnapshot,
} from "./types";

const GROUP = "grid";
const MAIN_PANE = "candle_pane"; // v9's candle pane id, as reported by listIndicators()
const DEFAULT_SYNC: SyncConfig = {
  symbol: false, interval: false,
  crosshair: true, drawings: true, indicators: true, time: true, dateRange: true,
};

export interface ChartManagerOptions {
  datafeed: Datafeed;
  series?: SeriesSource;
  storage?: Storage;
  timezone?: string;
  theme?: Theme;
  sync?: SyncConfig;
  /** Per-instrument session, forwarded to SharedDatafeed for session-anchored derivation. */
  session?: (symbol: string) => SessionSpec | undefined;
}

interface Cell { chart: ChartController; el: HTMLElement; symbol: string; period: Period; }

export class ChartManager {
  private readonly sync = new SyncController();
  private readonly shared: Datafeed;
  private cells: Cell[] = [];
  private cfg: SyncConfig;
  private readonly opts: ChartManagerOptions;

  constructor(opts: ChartManagerOptions) {
    this.opts = opts;
    this.shared = createSharedDatafeed(opts.datafeed, { session: opts.session });
    this.cfg = { ...DEFAULT_SYNC, ...(opts.sync ?? {}) };
  }

  /** Create a chart in `el`, wire it into the group, and load its symbol/period. */
  addChart(el: HTMLElement, spec: { symbol: string; period: Period }): ChartController {
    const chart = createChart(el, {
      datafeed: this.shared,
      series: this.opts.series,
      storage: this.opts.storage,
      timezone: this.opts.timezone,
      theme: this.opts.theme,
      autoResize: true,
    });
    chart.attachSync(this.sync);
    chart.linkGroup(GROUP);
    chart.syncConfig(this.cfg);
    const cell: Cell = { chart, el, symbol: spec.symbol, period: spec.period };
    this.cells.push(cell);
    void this.loadCell(cell);
    return chart;
  }

  removeChart(chart: ChartController): void {
    const i = this.cells.findIndex((c) => c.chart === chart);
    if (i < 0) return;
    const [cell] = this.cells.splice(i, 1);
    this.sync.remove(cell.chart);
    cell.chart.dispose();
  }

  getCharts(): ChartController[] { return this.cells.map((c) => c.chart); }

  // ---- symbol / interval (COMMAND fan-out, whole layout) --------------------
  /** Change one chart's symbol; if symbol-sync is on, changes the whole layout. */
  async setSymbol(chart: ChartController, symbol: string): Promise<void> {
    const cell = this.cellOf(chart);
    if (!cell) return;
    if (this.cfg.symbol) await this.setSymbolAll(symbol);
    else { cell.symbol = symbol; await chart.setSymbol(symbol); }
  }
  async setPeriod(chart: ChartController, period: Period): Promise<void> {
    const cell = this.cellOf(chart);
    if (!cell) return;
    if (this.cfg.interval) await this.setPeriodAll(period);
    else { cell.period = period; await chart.setPeriod(period); }
  }
  async setSymbolAll(symbol: string): Promise<void> {
    await Promise.all(this.cells.map((c) => { c.symbol = symbol; return c.chart.setSymbol(symbol); }));
  }
  async setPeriodAll(period: Period): Promise<void> {
    await Promise.all(this.cells.map((c) => { c.period = period; return c.chart.setPeriod(period); }));
  }

  // ---- indicators (COMMAND fan-out, symbol-scoped) --------------------------
  /** Add an indicator to `chart`; if indicators-sync is on, add it to same-symbol siblings too. */
  addIndicator(chart: ChartController, name: BuiltinIndicator, paneId?: PaneId, params?: number[]): IndicatorId {
    const id = chart.addIndicator(name, paneId, params);
    if (this.cfg.indicators) {
      const sym = this.cellOf(chart)?.symbol;
      for (const c of this.cells) if (c.chart !== chart && c.symbol === sym) c.chart.addIndicator(name, paneId, params);
    }
    return id;
  }
  /** Remove an indicator from `chart`; if indicators-sync is on, remove the matching one
   *  (same name, same main-vs-sub-pane placement) from same-symbol siblings too. */
  removeIndicator(chart: ChartController, id: IndicatorId): void {
    const ref = chart.listIndicators().find((i) => i.id === id);
    chart.removeIndicator(id);
    if (!ref || !this.cfg.indicators) return;
    const onMain = (paneId: PaneId) => paneId === MAIN_PANE;
    const sym = this.cellOf(chart)?.symbol;
    for (const c of this.cells) {
      if (c.chart === chart || c.symbol !== sym) continue;
      const peer = c.chart.listIndicators().find((i) => i.name === ref.name && onMain(i.paneId) === onMain(ref.paneId));
      if (peer) c.chart.removeIndicator(peer.id);
    }
  }

  // ---- sync config ----------------------------------------------------------
  setSync(cfg: Partial<SyncConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
    for (const c of this.cells) c.chart.syncConfig(this.cfg);
  }
  getSync(): SyncConfig { return { ...this.cfg }; }

  // ---- persistence ----------------------------------------------------------
  serializeLayout(): GridSnapshot {
    return {
      version: 1,
      cells: this.cells.map((c) => ({ symbol: c.symbol, period: c.period, layout: c.chart.serialize() })),
    };
  }
  /** Apply a snapshot onto the current cells, by index (cells must already exist). */
  async restoreLayout(snap: GridSnapshot): Promise<void> {
    for (let i = 0; i < this.cells.length && i < snap.cells.length; i++) {
      const cell = this.cells[i];
      const saved = snap.cells[i];
      cell.symbol = saved.symbol; cell.period = saved.period;
      await cell.chart.setPeriod(saved.period);
      await cell.chart.setSymbol(saved.symbol);
      cell.chart.restore(saved.layout);
    }
  }

  disposeAll(): void {
    for (const c of this.cells) { this.sync.remove(c.chart); c.chart.dispose(); }
    this.cells = [];
  }

  private cellOf(chart: ChartController): Cell | undefined { return this.cells.find((c) => c.chart === chart); }
  private async loadCell(cell: Cell): Promise<void> {
    await cell.chart.setPeriod(cell.period);
    await cell.chart.setSymbol(cell.symbol);
  }
}
