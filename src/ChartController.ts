// ChartController — the imperative API the host drives (kb/API.md §4).
// Native v9 calls are wired; build-on-primitive methods compose from v9
// primitives (see kb/KLINECHART_MAPPING.md). Adapted for the QuantPrime
// integration: bars always enter as {ts:number(ms epoch), ohlcv}.

import { init, dispose, LoadDataType, ActionType } from "klinecharts";
import type { Chart, KLineData } from "klinecharts";
import type { ChartOptions } from "./adapters";
import { BarBuilder } from "./BarBuilder";
import { periodToMs } from "./session";
import { resolveTheme } from "./theme";
import { TradeLayer, barIndexAtOrBefore } from "./tradeLayer";
import type {
  Bar, Period, BuiltinIndicator, PaneId, PaneOptions, PaneInfo, IndicatorId,
  SeriesId, SeriesPoint, SeriesMeta, DrawTool, DrawingId, Point, DrawStyle,
  Marker, PriceLineStyle, LoadingState, LayoutSnapshot, SyncConfig, Unsubscribe,
  TickLineEvents, TickLineError, DrawingSnapshot, TradePosition, LevelLine, Theme,
} from "./types";

// v9's real candle pane id (the default main pane KLineChart creates).
// TickLine exposes this publicly as "main" (kb/API.md); resolvePane translates.
const MAIN_PANE = "candle_pane";

const DEFAULT_TIMEZONE = "UTC"; // consumer-neutral (D-T1/D-T5); QuantPrime passes "Asia/Kolkata"
const DAY = 86_400_000;
// Initial lookback AND per-scroll page size (backfill / forward paging), scaled per period:
// >=7 calendar days so intraday TFs span weekends/holidays, >=TARGET_BARS periods so D/W
// charts aren't near-empty, <=MAX_BARS periods so second-level TFs don't request ~600k bars.
const MIN_WINDOW = 7 * DAY;
const TARGET_BARS = 500;
const MAX_BARS = 20_000;

// friendly DrawTool -> v9 overlay name (kb/KLINECHART_MAPPING.md)
const OVERLAY_NAME: Record<string, string> = {
  trendline: "segment", ray: "rayLine", hline: "horizontalStraightLine",
  vline: "verticalStraightLine", rect: "rect", fib: "fibonacciLine", text: "simpleAnnotation",
};

// Reserved overlay ids for the synced "linked cursor" (v9 has no public
// setCrosshair; SyncController drives these via setCrosshair/clearCrosshair).
const XHAIR_V = "__tickline_xhair_v";
const XHAIR_H = "__tickline_xhair_h";

// The subset of ChartController that SyncController drives. Declared structurally
// so ChartController can hold a binder without importing SyncController (no cycle).
export interface SyncBinder {
  add(chart: ChartController, groupId: string): void;
  remove(chart: ChartController): void;
  setConfig(chart: ChartController, cfg: SyncConfig): void;
}

function toKLine(b: Bar): KLineData {
  return { timestamp: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

type Handler<K extends keyof TickLineEvents> = (e: TickLineEvents[K]) => void;

interface OverlayRec { tool: DrawTool; paneId: PaneId; points: Point[]; style?: DrawStyle; }
interface PaneRec { height?: number; sticky?: boolean; live: boolean; }

export class ChartController {
  private chart: Chart;
  private opts: ChartOptions;
  private el: HTMLElement;
  private handlers = new Map<keyof TickLineEvents, Set<Function>>();
  private subscribed = new Set<keyof TickLineEvents>(); // v9 action subscriptions (ref by type)
  private indicators = new Map<IndicatorId, { paneId: PaneId; name: string }>();
  private overlays = new Map<DrawingId, OverlayRec>();
  private panes = new Map<PaneId, PaneRec>(); // incl. MAIN_PANE once materialized
  private loadingEl: HTMLDivElement | null = null;
  private _loadingState: LoadingState = "ready";
  private resizeObs: ResizeObserver | null = null;
  private datafeedUnsub: Unsubscribe | null = null;
  private symbol = "";
  private period: Period = "1m";
  private disposed = false;
  private syncBinder?: SyncBinder;
  private syncGroup: string | null = null;
  private xhairIds = new Set<string>();
  private trade: TradeLayer;
  private loadSeq = 0; // guards against a slow reload overwriting a newer one (rapid replay seeks)
  private holdNewer = false; // decline Backward (newer-bar) loads while we position the view

  constructor(el: HTMLElement, opts: ChartOptions) {
    const theme = resolveTheme(opts.theme);
    const c = init(el, {
      timezone: opts.timezone ?? DEFAULT_TIMEZONE,
      locale: opts.locale,
      styles: theme.styles as never,
    });
    if (!c) throw new Error("TickLine: KLineChart init() returned null");
    this.chart = c;
    this.opts = opts;
    this.el = el;
    if (theme.background) el.style.background = theme.background;
    this.trade = new TradeLayer(c, () => this.periodMs());
    this.panes.set(MAIN_PANE, { live: true, sticky: true });

    // Load-more callback. KLineChart v9 direction semantics (verified in
    // index.esm.js):  Forward = PREPEND older bars (fires scrolling to the
    // oldest bar, from===0);  Backward = APPEND newer bars (fires at the
    // newest bar, to===totalBarCount, e.g. on init when right-pinned).
    // TickLine pushes LIVE bars via Datafeed.subscribe, so for live feeds the
    // Backward direction is answered empty; history backfill (Forward) hits the
    // datafeed. (NOTE: this is the opposite of the names' intuition.)
    // Bounded feeds (Datafeed.getRange — historical/replay) also page NEWER bars
    // on Backward, so a chart opened mid-history via jumpTo() can scroll right.
    this.chart.setLoadDataCallback((params) => {
      const df = opts.datafeed;
      const range = this.feedRange();
      if (params.type === LoadDataType.Forward) {
        // older bars than the current oldest -> prepend (history backfill)
        const before = params.data?.timestamp ?? Date.now();
        this.emit("needHistory", { symbol: this.symbol, period: this.period, before });
        if (df && this.symbol && (!range || before > range.from)) {
          df.getBars(this.symbol, this.period, before - this.windowMs(), before - 1).then((bars) => {
            const more = bars.length > 0 && (!range || bars[0].ts > range.from);
            params.callback(bars.map(toKLine), more);
            this.trade.sync();
          }).catch((err) => {
            this.emitError({ kind: "datafeed", op: "getBars(backfill)", message: String(err?.message ?? err), cause: err, retryable: true });
            params.callback([], false);
          });
        } else {
          params.callback([], false);
        }
      } else if (params.type === LoadDataType.Backward) {
        // Re-entrant fire while we place the view (jumpTo init, or the append
        // below): decline but keep `more`, so it fires again when the user
        // actually scrolls to the newest bar.
        if (this.holdNewer) { params.callback([], true); return; }
        const after = params.data?.timestamp;
        const seq = this.loadSeq;
        if (df && this.symbol && range && after != null && after < range.to) {
          df.getBars(this.symbol, this.period, after + 1, after + this.windowMs()).then((bars) => {
            if (seq !== this.loadSeq || this.disposed) { params.callback([], false); return; } // superseded by a reload
            const more = bars.length > 0 && bars[bars.length - 1].ts < range.to;
            // v9 keeps the view's offset from the RIGHT edge, so appending N bars
            // would jump the view to the new end (and cascade-load to the feed's
            // end). Scroll back by N bars to keep what the user was looking at.
            this.holdNewer = true;
            try {
              params.callback(bars.map(toKLine), more);
              if (bars.length) this.chart.scrollByDistance(bars.length * this.chart.getBarSpace());
            } finally { this.holdNewer = false; }
            this.trade.sync();
            // Paged back up to the feed's newest bar (after a jumpTo): resume live updates.
            if (!more) this.armLive();
          }).catch((err) => {
            this.emitError({ kind: "datafeed", op: "getBars(forward)", message: String(err?.message ?? err), cause: err, retryable: true });
            params.callback([], false);
          });
        } else {
          // live feed: newer bars arrive via subscribe. Answer empty so
          // `_loading`/`_backwardMore` reset and the callback doesn't refire.
          params.callback([], false);
          if (range && after != null && after >= range.to) this.armLive();
        }
      }
    });

    // autoResize via ResizeObserver (the robust pattern; opts.autoResize opt-in).
    if (opts.autoResize && typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => { if (!this.disposed) this.chart.resize(); });
      this.resizeObs.observe(el);
    }
    // Precision: v9 sets price AND volume precision together (E14). When the
    // consumer supplies `precision`, apply it to both; otherwise leave v9 defaults.
    if (opts.precision != null) this.chart.setPriceVolumePrecision(opts.precision, opts.precision);
  }

  // ---- internal: pane resolution
  /** Translate the public "main" id (or undefined) to v9's candle pane. */
  private resolvePane(paneId?: PaneId): PaneId {
    if (paneId === undefined || paneId === "main") return MAIN_PANE;
    return paneId;
  }

  // ---- internal: event bus + error channel
  private emit<K extends keyof TickLineEvents>(type: K, payload: TickLineEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) try { (h as Handler<K>)(payload); } catch { /* listener fault is isolated */ }
  }

  private emitError(err: TickLineError): void {
    this.setLoading("error");
    this.emit("error", err);
  }

  /** Ensure v9 subscribeAction is wired exactly once per event type. */
  private ensureAction(type: keyof TickLineEvents): void {
    if (this.subscribed.has(type)) return;
    this.subscribed.add(type);
    if (type === "crosshairMove") {
      this.chart.subscribeAction(ActionType.OnCrosshairChange, (d) => {
        const data: any = d;
        const ts = data?.kLineData?.timestamp ?? data?.timestamp ?? 0;
        const value = data?.kLineData?.close ?? data?.value ?? 0;
        this.emit("crosshairMove", { ts, value });
      });
    } else if (type === "visibleRangeChange") {
      this.chart.subscribeAction(ActionType.OnVisibleRangeChange, () => {
        const r = this.getVisibleRange();
        if (r.from || r.to) this.emit("visibleRangeChange", r); // skip the empty-chart range
      });
    } else if (type === "click") {
      this.chart.subscribeAction(ActionType.OnCandleBarClick, (d) => {
        const data: any = d;
        const ts = data?.timestamp ?? 0;
        const value = data?.value ?? 0;
        this.emit("click", { ts, value });
      });
    }
  }

  // ---- Lifecycle
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncBinder?.remove(this);
    this.datafeedUnsub?.();
    this.datafeedUnsub = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.handlers.clear();
    dispose(this.chart);
    this.loadingEl?.remove();
    this.loadingEl = null;
  }
  resize(): void { this.chart.resize(); }
  setLoading(state: LoadingState): void {
    this._loadingState = state;
    if (state === "ready") { this.loadingEl?.remove(); this.loadingEl = null; return; }
    if (!this.loadingEl) {
      const div = document.createElement("div");
      div.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font:12px ui-monospace,monospace;color:#a1a1aa;background:rgba(0,0,0,0.35);z-index:10;";
      this.loadingEl = div;
      const positioned = this.el.style.position === "static" || !this.el.style.position;
      if (positioned) this.el.style.position = "relative";
      this.el.appendChild(div);
    }
    const labels: Record<LoadingState, string> = {
      loading: "Loading…", empty: "No data", error: "Error — see console", ready: "",
    };
    this.loadingEl.textContent = labels[state];
  }

  // ---- Data
  setData(bars: Bar[]): void { this.chart.applyNewData(bars.map(toKLine)); this.trade.sync(); }
  updateData(bar: Bar): void { this.chart.updateData(toKLine(bar)); this.trade.sync(); }
  prependData(bars: Bar[]): void { for (const b of bars) this.chart.updateData(toKLine(b)); this.trade.sync(); } // older bars: upsert by timestamp
  clearData(): void { this.chart.clearData(); this.trade.sync(); }

  async setSymbol(symbol: string): Promise<void> {
    this.symbol = symbol;
    await this.reload();
  }
  async setPeriod(period: Period): Promise<void> {
    this.period = period;
    await this.reload();
  }
  /** Re-fetch the current symbol/period from the datafeed (e.g. after a replay seek). */
  async refresh(): Promise<void> { await this.reload(); }

  /** Bring `ts` into view. If it is outside the loaded bars, reload a window centred on it
   *  (bounded feeds then page older AND newer bars on scroll). */
  async jumpTo(ts: number): Promise<void> {
    const list = this.chart.getDataList?.() ?? [];
    const inside = list.length > 0 && ts >= list[0].timestamp && ts <= list[list.length - 1].timestamp;
    if (!inside) {
      // applyNewData opens right-pinned, which fires a Backward load at once —
      // hold it until the view sits on `ts`.
      this.holdNewer = true;
      try { await this.reload(ts); } finally { this.holdNewer = false; }
    }
    this.centerOn(ts);
  }

  /** Scroll so `ts` sits mid-screen (v9's scrollToTimestamp puts it at the right edge). */
  private centerOn(ts: number): void {
    const list = this.chart.getDataList?.() ?? [];
    if (!list.length) { this.chart.scrollToTimestamp(ts); return; }
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].timestamp < ts) lo = mid + 1; else hi = mid; }
    const space = this.chart.getBarSpace?.() || 8;
    const half = Math.floor((this.el.clientWidth || 800) / space / 2);
    this.chart.scrollToDataIndex(Math.min(list.length - 1, lo + half));
  }

  private feedRange(): { from: number; to: number } | null {
    if (!this.symbol) return null;
    return this.opts.datafeed?.getRange?.(this.symbol, this.period) ?? null;
  }

  /** Swap the datafeed subscription + refetch bars for the current symbol/period.
   *  `anchor` (jumpTo) loads a window centred on it instead of ending at the newest bar. */
  private async reload(anchor?: number): Promise<void> {
    const df = this.opts.datafeed;
    if (!df || !this.symbol) return;
    const seq = ++this.loadSeq;
    this.setLoading("loading");
    try {
      this.datafeedUnsub?.();
      this.datafeedUnsub = null;
      const range = this.feedRange();
      let from: number, to: number;
      const win = this.windowMs();
      const liveEdge = range?.to ?? Date.now(); // bounded feeds open at their END, live feeds at "now"
      if (anchor != null) {
        from = anchor - win / 2;
        to = Math.min(anchor + win / 2, liveEdge);
      } else {
        to = liveEdge;
        from = to - win;
      }
      const bars = await df.getBars(this.symbol, this.period, from, to);
      if (seq !== this.loadSeq || this.disposed) return; // superseded by a newer reload
      const olderMore = bars.length > 0 && (!range || bars[0].ts > range.from);
      this.chart.applyNewData(bars.map(toKLine), olderMore);
      this.trade.sync();
      // Live path (subscribe) only when the window reaches the feed's newest bar —
      // appending live bars to a mid-history window would leave a gap.
      if (to >= liveEdge) this.armLive();
      this.setLoading(bars.length === 0 ? "empty" : "ready");
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.emitError({ kind: "datafeed", op: "setSymbol/setPeriod", message: String((err as Error)?.message ?? err), cause: err, retryable: true });
    }
  }

  /** Subscribe to live bars for the current symbol/period, unless already subscribed. */
  private armLive(): void {
    const df = this.opts.datafeed;
    if (!df || !this.symbol || this.datafeedUnsub || this.disposed) return;
    this.datafeedUnsub = df.subscribe(this.symbol, this.period, (bar) => this.updateData(bar));
  }

  /** Not-yet-implemented methods report on the error channel instead of throwing (kb/ARCHITECTURE.md §10). */
  private notImplemented(method: string, kind: string): void {
    this.emitError({
      kind: "series", op: method, retryable: false,
      message: `TickLine: ${method}() not yet implemented (${kind}). See kb/KLINECHART_MAPPING.md.`,
    });
  }

  // ---- Panes (v9 has no standalone createPane — panes are indicator side-effects)
  createPane(opts?: PaneOptions): PaneId {
    const id = opts?.id ?? `pane_${Math.random().toString(36).slice(2, 9)}`;
    this.panes.set(id, { height: opts?.height, sticky: opts?.sticky, live: false });
    return id;
  }
  removePane(paneId: PaneId): void {
    if (paneId === "main" || paneId === MAIN_PANE) return; // main pane protected
    // remove all indicators in this pane
    for (const [indId, ref] of [...this.indicators]) {
      if (ref.paneId === paneId) { this.chart.removeIndicator(paneId, ref.name); this.indicators.delete(indId); }
    }
    this.panes.delete(paneId);
  }
  resizePane(paneId: PaneId, height: number): void {
    const pane = this.resolvePane(paneId);
    const rec = this.panes.get(pane);
    if (rec) rec.height = height;
    if (this.panes.get(pane)?.live) this.chart.setPaneOptions({ id: pane, height });
  }
  movePaneSeries(_seriesId: SeriesId, _paneId: PaneId): void { this.notImplemented("movePaneSeries", "build-compose"); }
  getPanes(): PaneInfo[] {
    return [...this.panes.entries()].filter(([, r]) => r.live).map(([id, r]) => ({ id, height: r.height ?? 0 }));
  }

  // ---- Indicators (Tier 1 — native built-ins)
  addIndicator(name: BuiltinIndicator, paneId?: PaneId, params?: number[]): IndicatorId {
    const pane = this.resolvePane(paneId);
    // isStack rule (mirrors PriceChart.tsx): main-pane target => overlay on candles (stack);
    // a created sub-pane => standalone (no stack). See ARCHITECTURE note in kb/API.md §4.3.
    const isStack = pane === MAIN_PANE;
    const created = this.chart.createIndicator(
      { name, calcParams: params } as never,
      isStack,
      { id: pane },
    );
    const usedPane = created ?? pane;
    // materialize pane registry + apply recorded height
    const rec = this.panes.get(usedPane);
    if (rec) { rec.live = true; if (rec.height != null) this.chart.setPaneOptions({ id: usedPane, height: rec.height }); }
    else this.panes.set(usedPane, { live: true, sticky: false });
    const id = `ind_${name}_${usedPane}`;
    this.indicators.set(id, { paneId: usedPane, name });
    return id;
  }
  removeIndicator(id: IndicatorId): void {
    const ref = this.indicators.get(id);
    if (!ref) return;
    this.chart.removeIndicator(ref.paneId, ref.name);
    this.indicators.delete(id);
    // auto-remove a non-sticky sub-pane that just lost its last indicator
    const pane = ref.paneId;
    if (pane !== MAIN_PANE) {
      const stillUsed = [...this.indicators.values()].some((r) => r.paneId === pane);
      const rec = this.panes.get(pane);
      if (!stillUsed && rec && !rec.sticky) this.removePane(pane);
    }
  }
  listIndicators(): { id: IndicatorId; name: string; paneId: PaneId }[] {
    return [...this.indicators].map(([id, r]) => ({ id, name: r.name, paneId: r.paneId }));
  }

  // ---- Series (Tier 2 — host-computed via registerIndicator custom template)
  plotSeries(_paneId: PaneId, _points: SeriesPoint[], _meta: SeriesMeta): SeriesId {
    this.notImplemented("plotSeries", "build-indicator (registerIndicator external-series)");
    return "";
  }
  updateSeries(_id: SeriesId, _point: SeriesPoint): void { this.notImplemented("updateSeries", "build-indicator"); }
  removeSeries(_id: SeriesId): void { this.notImplemented("removeSeries", "build-indicator"); }

  // ---- Drawings
  // Points cross the boundary as TickLine {ts, value}; v9 wants {timestamp, value}.
  private toV9Points(points?: Point[]): Array<{ timestamp: number; value: number }> | undefined {
    return points?.map((p) => ({ timestamp: p.ts, value: p.value }));
  }
  private fromV9Points(overlay: { points?: Array<{ timestamp?: number; value?: number }> }): Point[] {
    return (overlay.points ?? []).map((p) => ({ ts: p.timestamp ?? 0, value: p.value ?? 0 }));
  }

  /** v9 overlay lifecycle callbacks -> TickLine events (drawingCreated/Modified/Removed). */
  private makeOverlayHandlers(tool: DrawTool): Record<string, (e: { overlay?: { id?: string; points?: Array<{ timestamp?: number; value?: number }> } }) => boolean> {
    return {
      // interactive draw completed -> drawingCreated
      onDrawEnd: (e) => {
        const id = e.overlay?.id; if (!id) return false;
        const pts = this.fromV9Points(e.overlay ?? {});
        const rec = this.overlays.get(id);
        if (rec) rec.points = pts; else this.overlays.set(id, { tool, paneId: MAIN_PANE, points: pts });
        this.emit("drawingCreated", { id, tool, points: pts });
        return false;
      },
      // drag-to-modify ended -> drawingModified
      onPressedMoveEnd: (e) => {
        const id = e.overlay?.id; if (!id) return false;
        const pts = this.fromV9Points(e.overlay ?? {});
        const rec = this.overlays.get(id);
        const t = rec?.tool ?? tool;
        if (rec) rec.points = pts;
        this.emit("drawingModified", { id, tool: t, points: pts });
        return false;
      },
      // removed (programmatic or user) -> drawingRemoved
      onRemoved: (e) => {
        const id = e.overlay?.id; if (!id) return false;
        this.overlays.delete(id);
        this.emit("drawingRemoved", { id });
        return false;
      },
    };
  }

  /** Create an overlay with lifecycle handlers wired; track in the registry. Used by draw() and restore(). */
  private createTracked(tool: DrawTool, points?: Point[], style?: DrawStyle): DrawingId {
    const name = OVERLAY_NAME[tool] ?? tool;
    const id = this.chart.createOverlay({
      name, points: this.toV9Points(points), ...this.makeOverlayHandlers(tool),
    } as never);
    const did = (Array.isArray(id) ? id[0] : id) ?? "";
    if (did) this.overlays.set(did, { tool, paneId: MAIN_PANE, points: points ?? [], style });
    return did;
  }

  draw(tool: DrawTool, points?: Point[], style?: DrawStyle): DrawingId {
    const did = this.createTracked(tool, points, style);
    // Programmatic draws (points given) get drawingCreated immediately; interactive
    // draws (no points) fire it via onDrawEnd when the user finishes.
    if (did && points && points.length) this.emit("drawingCreated", { id: did, tool, points });
    return did;
  }
  updateDrawing(id: DrawingId, points: Point[]): void {
    this.chart.overrideOverlay({ id, points: this.toV9Points(points) } as never);
    const rec = this.overlays.get(id);
    if (rec) rec.points = points;
    this.emit("drawingModified", { id, tool: rec?.tool ?? "trendline", points });
  }
  removeDrawing(id: DrawingId): void {
    // removeOverlay fires the overlay's onRemoved -> drawingRemoved + registry delete.
    this.chart.removeOverlay(id);
    // Safety net in case the engine doesn't fire onRemoved for this id.
    if (this.overlays.has(id)) { this.overlays.delete(id); this.emit("drawingRemoved", { id }); }
  }
  clearDrawings(): void {
    const ids = [...this.overlays.keys()];
    this.chart.removeOverlay(); // remove all (incl. the synced-cursor + trade overlays)
    this.overlays.clear();
    this.xhairIds.clear();      // cursors were removed too; forget them so setCrosshair recreates
    this.trade.invalidate();    // trade annotations aren't drawings — bring them back
    for (const id of ids) this.emit("drawingRemoved", { id });
  }
  serialize(): LayoutSnapshot {
    const drawings: DrawingSnapshot[] = [...this.overlays.entries()].map(([id, r]) => ({
      id, tool: r.tool, points: r.points, ...(r.style ? { style: r.style } : {}),
    }));
    const r = this.getVisibleRange();
    return {
      version: 1,
      drawings,
      panes: this.getPanes(),
      seriesSpecs: [], // Tier 2 not yet live
      viewRange: { from: r.from, to: r.to },
    };
  }
  restore(json: LayoutSnapshot): void {
    this.clearDrawings();
    // Re-create silently (no drawingCreated burst) — restore is a bulk rehydrate.
    for (const d of json.drawings ?? []) this.createTracked(d.tool, d.points, d.style);
    for (const p of json.panes ?? []) if (p.height != null) this.resizePane(p.id, p.height);
    if (json.viewRange) this.setVisibleRange(json.viewRange.from, json.viewRange.to);
  }

  // ---- Trade primitives
  // `priceLine` uses v9's NATIVE priceLine overlay (verified registered:
  // getSupportedOverlays() includes "priceLine"). Upsert-by-id; the native
  // overlay auto-renders the price as the y-axis label. A custom text label
  // ("Entry"/"SL") needs a custom overlay template (v1.5).
  priceLine(id: string, price: number, style?: PriceLineStyle): void {
    this.chart.removeOverlay(id); // upsert: clear any existing overlay with this id
    this.chart.createOverlay({
      name: "priceLine",
      id,
      points: [{ value: price }],
      styles: style?.color ? { line: { color: style.color, size: style.width ?? 1 } } : undefined,
    } as never);
  }
  removePriceLine(id: string): void { this.chart.removeOverlay(id); }

  // Trade annotations (TradeLayer): replace-all setters, non-interactive, not
  // serialized. Each is shown only while its bar is loaded — so in replay they
  // appear as the replay reaches them.
  /** Buy/sell arrows, circles, squares on bars (custom `tlMarker` overlay). */
  setMarkers(marks: Marker[]): void { this.trade.setMarkers(marks); }
  /** TradingView-style Long/Short Position boxes (custom `tlPosition` overlay). */
  setPositions(positions: TradePosition[]): void { this.trade.setPositions(positions); }
  /** Horizontal levels over a time span, e.g. PDH/PDL per day (custom `tlLevel` overlay). */
  setLevels(levels: LevelLine[]): void { this.trade.setLevels(levels); }
  /** Remove all markers, positions and levels. */
  clearTradeAnnotations(): void { this.trade.clear(); }

  /** Switch theme at runtime ("dark" | "light" | raw v9 styles object). */
  setTheme(theme: Theme): void {
    const t = resolveTheme(theme);
    if (t.styles) this.chart.setStyles(t.styles as never);
    this.el.style.background = t.background ?? "";
  }

  // ---- View & sync
  setVisibleRange(from: number, to: number): void {
    // No native window setter: fit [from,to] by spacing, then pin `to` to the right
    // edge (v9's scrollToDataIndex/scrollToTimestamp place the target at the RIGHT edge).
    const list = this.chart.getDataList?.() ?? [];
    const width = this.el.clientWidth || 800;
    const toIdx = barIndexAtOrBefore(list, to);
    if (toIdx >= 0 && from >= list[0].timestamp) {
      // Count LOADED bars in the window: session gaps (nights, weekends) hold no bars,
      // so wall-clock span / period would overcount ~4x on NSE.
      const fromIdx = Math.max(0, barIndexAtOrBefore(list, from));
      this.chart.setBarSpace(Math.max(1, width / Math.max(1, toIdx - fromIdx + 1)));
      this.chart.scrollToDataIndex(toIdx);
    } else {
      // Window not (fully) loaded: approximate from the wall-clock span.
      const bars = Math.ceil(Math.max(1, to - from) / this.periodMs());
      this.chart.setBarSpace(Math.max(1, width / Math.max(1, bars)));
      this.chart.scrollToTimestamp(to);
    }
  }
  private periodMs(): number {
    try { return periodToMs(this.period); } catch { return 300_000; }
  }
  private windowMs(): number {
    const p = this.periodMs();
    return Math.min(Math.max(MIN_WINDOW, p * TARGET_BARS), p * MAX_BARS);
  }
  scrollTo(ts: number): void { this.chart.scrollToTimestamp(ts); }
  /** Zoom around a timestamp. `factor` is the KLineChart bar-space scale (px per bar);
   *  omit it to just center on `ts` without changing zoom (no-op zoom was the old bug). */
  zoomTo(ts: number, factor?: number): void {
    if (factor == null) this.chart.scrollToTimestamp(ts);
    else this.chart.zoomAtTimestamp(factor, ts);
  }
  /** Position a synced "linked cursor" at `ts` (+ optional price line at `value`).
   *  v9 has no public crosshair setter, so this is an overlay-based emulation used
   *  by multi-chart Time/Crosshair sync (kb/CHARTMANAGER.md §5). Cheap upsert (override). */
  setCrosshair(ts: number, value?: number): void {
    if (!ts) { this.clearCrosshair(); return; }
    this.upsertCursor(XHAIR_V, "verticalStraightLine", [{ timestamp: ts }]);
    if (value != null) this.upsertCursor(XHAIR_H, "horizontalStraightLine", [{ value }]);
  }
  clearCrosshair(): void {
    for (const id of this.xhairIds) this.chart.removeOverlay(id);
    this.xhairIds.clear();
  }
  private upsertCursor(id: string, name: string, points: Array<{ timestamp?: number; value?: number }>): void {
    if (this.xhairIds.has(id)) {
      this.chart.overrideOverlay({ id, points } as never);
    } else {
      this.chart.createOverlay({
        id, name, points, lock: true,
        styles: { line: { color: "#a78bfa", style: "dashed", size: 1 } },
      } as never);
      this.xhairIds.add(id);
    }
  }
  /** Visible window as timestamps (ms). v9's getVisibleRange() returns bar INDICES
   *  ([from, to) into the data list); translate so the public API speaks time. */
  getVisibleRange(): { from: number; to: number } {
    const r = this.chart.getVisibleRange();
    const list = this.chart.getDataList?.() ?? [];
    if (!list.length) return { from: 0, to: 0 };
    const at = (i: number) => list[Math.min(list.length - 1, Math.max(0, i))].timestamp;
    return { from: at(r.from), to: at(r.to - 1) };
  }
  setTimezone(tz: string): void { this.chart.setTimezone(tz); } // v1, native (D-T5)

  // ---- Groups (SyncController wires these; ChartManager injects the binder)
  /** @internal — ChartManager wires a SyncController in so linkGroup/syncConfig work. */
  attachSync(binder: SyncBinder): void { this.syncBinder = binder; }
  linkGroup(groupId: string | null): void {
    this.syncGroup = groupId;
    if (!this.syncBinder) return;
    this.syncBinder.remove(this);
    if (groupId) this.syncBinder.add(this, groupId);
  }
  syncConfig(cfg: SyncConfig): void { this.syncBinder?.setConfig(this, cfg); }

  /** Current symbol / period (read-only; SyncController partitions crosshair+drawings by symbol). */
  get symbolId(): string { return this.symbol; }
  get periodId(): Period { return this.period; }
  get group(): string | null { return this.syncGroup; }

  // ---- Events
  on<K extends keyof TickLineEvents>(type: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(type) as Set<Handler<K>> | undefined;
    if (!set) { set = new Set(); this.handlers.set(type, set as Set<Function>); }
    set.add(handler);
    // Lazy-wire the v9 action subscription for the typed events.
    if (type === "crosshairMove" || type === "visibleRangeChange" || type === "click") {
      this.ensureAction(type);
    }
    return () => { set!.delete(handler); };
  }

  /** The adapters/config this chart was created with (datafeed, series, storage, …). */
  get options(): Readonly<ChartOptions> { return this.opts; }

  /** Current loading/error overlay state (kb/ARCHITECTURE.md §10). */
  get loadingState(): LoadingState { return this._loadingState; }

  /** Escape hatch for the build phase / advanced hosts. */
  get raw(): Chart { return this.chart; }
}

/** Build a live-updating chart from a Datafeed. The primary factory (kb/API.md §1). */
export function createChart(el: HTMLElement, opts: ChartOptions): ChartController {
  return new ChartController(el, opts);
}

// Re-export so consumers can reach BarBuilder without a second import.
export { BarBuilder };
