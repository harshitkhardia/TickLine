// BacktestView — a ready-made backtest viewer: one chart over in-memory bars,
// trade annotations (markers / position boxes / levels), and a toolbar with
// Chart|Replay modes, replay transport (⏮ ▶/⏸ ▸ speed scrubber) and
// prev/next-trade navigation. Mounted by the demo (demo/backtest.html) and by
// the Jupyter widget (widget/anywidget.ts), so both behave identically.

import { ChartController } from "./ChartController";
import { StaticDatafeed, barsFromColumns, type BarColumns } from "./StaticDatafeed";
import { ReplayDatafeed, attachReplay } from "./ReplayDatafeed";
import { THEMES } from "./theme";
import type { Datafeed } from "./adapters";
import type { Bar, Marker, TradePosition, LevelLine, Period, ReplayState, Unsubscribe } from "./types";

export interface BacktestAnnotations {
  markers?: Marker[];
  positions?: TradePosition[];
  levels?: LevelLine[];
}

export interface BacktestViewOptions extends BacktestAnnotations {
  bars: Bar[] | BarColumns;
  symbol?: string;
  period?: Period;
  title?: string;
  theme?: "dark" | "light";
  timezone?: string;       // display only (bars stay UTC)
  height?: number;         // px; default 520
  precision?: number;
  mode?: "chart" | "replay";
  /** Replay start: bar index or ms timestamp. Default: ~60 bars before the first trade. */
  replayStart?: number;
  speed?: number;          // replay bars/second; default 10
}

const SPEEDS = [1, 2, 5, 10, 20, 50, 100, 300];
const LEAD_BARS = 60; // replay starts this many bars before a trade's entry

let cssInjected = false;
function injectCss(): void {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const s = document.createElement("style");
  s.textContent = `
.tl-bt{display:flex;flex-direction:column;font:12px ui-monospace,Menlo,Consolas,monospace;border-radius:6px;overflow:hidden;outline:none}
.tl-bt[data-theme=dark]{--tl-bg:#0e0e11;--tl-bar:#16161a;--tl-fg:#d4d4d8;--tl-mut:#71717a;--tl-bd:#27272a;--tl-acc:#a78bfa;--tl-btn:#1f1f24}
.tl-bt[data-theme=light]{--tl-bg:#fff;--tl-bar:#f4f4f5;--tl-fg:#27272a;--tl-mut:#71717a;--tl-bd:#e4e4e7;--tl-acc:#7c3aed;--tl-btn:#fff}
.tl-bt{background:var(--tl-bg);color:var(--tl-fg);border:1px solid var(--tl-bd)}
.tl-bt-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;background:var(--tl-bar);border-bottom:1px solid var(--tl-bd)}
.tl-bt-bar button,.tl-bt-bar select{font:inherit;color:var(--tl-fg);background:var(--tl-btn);border:1px solid var(--tl-bd);border-radius:4px;padding:2px 8px;cursor:pointer;min-height:24px}
.tl-bt-bar button:hover{border-color:var(--tl-acc)}
.tl-bt-bar button[aria-pressed=true]{background:var(--tl-acc);border-color:var(--tl-acc);color:#fff}
.tl-bt-bar button:disabled{opacity:.4;cursor:default}
.tl-bt-title{font-weight:600;margin-right:6px}
.tl-bt-sep{width:1px;height:18px;background:var(--tl-bd);margin:0 2px}
.tl-bt-grp{display:flex;align-items:center;gap:4px}
.tl-bt-mut{color:var(--tl-mut)}
.tl-bt-scrub{flex:1;min-width:120px;accent-color:var(--tl-acc)}
.tl-bt-chart{flex:1;position:relative;min-height:0}
.tl-bt[data-mode=chart] .tl-bt-replay{display:none}
`;
  document.head.appendChild(s);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

export class BacktestView {
  readonly chart: ChartController;
  private root: HTMLDivElement;
  private symbol: string;
  private period: Period;
  private bars: Bar[] = [];
  private staticFeed = new StaticDatafeed();
  private replay: ReplayDatafeed | null = null;
  private replayUnsubs: Unsubscribe[] = [];
  private active: Datafeed;
  private mode: "chart" | "replay" = "chart";
  private positions: TradePosition[] = [];
  private tradeIdx = -1;
  private speed: number;
  private replayStart?: number;
  private fmt: Intl.DateTimeFormat;
  private ui: {
    chartBtn: HTMLButtonElement; replayBtn: HTMLButtonElement; play: HTMLButtonElement;
    speed: HTMLSelectElement; scrub: HTMLInputElement; clock: HTMLSpanElement;
    prev: HTMLButtonElement; next: HTMLButtonElement; tradeLbl: HTMLSpanElement;
  };

  constructor(el: HTMLElement, opts: BacktestViewOptions) {
    injectCss();
    this.symbol = opts.symbol ?? "SYMBOL";
    this.period = opts.period ?? "1m";
    this.speed = opts.speed ?? 10;
    this.replayStart = opts.replayStart;
    this.fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: opts.timezone ?? "UTC", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const theme = opts.theme ?? "dark";

    // ---- DOM
    this.root = h("div", { class: "tl-bt", tabindex: "0", "data-theme": theme, "data-mode": "chart" });
    this.root.style.height = `${opts.height ?? 520}px`;
    const bar = h("div", { class: "tl-bt-bar" });
    if (opts.title) bar.append(h("span", { class: "tl-bt-title" }, opts.title));
    const modeGrp = h("div", { class: "tl-bt-grp", role: "group", "aria-label": "Mode" });
    const chartBtn = h("button", { type: "button", "aria-pressed": "true", title: "Static chart" }, "Chart");
    const replayBtn = h("button", { type: "button", "aria-pressed": "false", title: "Bar replay" }, "Replay");
    modeGrp.append(chartBtn, replayBtn);

    const rp = h("div", { class: "tl-bt-grp tl-bt-replay" });
    const toStart = h("button", { type: "button", title: "Back to replay start", "aria-label": "Back to start" }, "⏮");
    const play = h("button", { type: "button", title: "Play / pause (Space)", "aria-label": "Play" }, "▶");
    const step = h("button", { type: "button", title: "Step one bar (→)", "aria-label": "Step one bar" }, "▸|");
    const speed = h("select", { title: "Replay speed (bars per second)", "aria-label": "Replay speed" });
    for (const s of SPEEDS) {
      const o = h("option", { value: String(s) }, `${s}×`);
      if (s === this.speed) o.selected = true;
      speed.append(o);
    }
    rp.append(toStart, play, step, speed);
    const scrub = h("input", { type: "range", class: "tl-bt-scrub tl-bt-replay", min: "0", max: "0", value: "0", "aria-label": "Replay position" });
    const clock = h("span", { class: "tl-bt-mut tl-bt-replay" }, "");

    const tradeGrp = h("div", { class: "tl-bt-grp" });
    const prev = h("button", { type: "button", title: "Previous trade", "aria-label": "Previous trade" }, "◀");
    const tradeLbl = h("span", { class: "tl-bt-mut" }, "no trades");
    const next = h("button", { type: "button", title: "Next trade", "aria-label": "Next trade" }, "▶");
    tradeGrp.append(prev, tradeLbl, next);

    bar.append(modeGrp, h("span", { class: "tl-bt-sep" }), rp, scrub, clock, h("span", { class: "tl-bt-sep" }), tradeGrp);
    const chartEl = h("div", { class: "tl-bt-chart" });
    this.root.append(bar, chartEl);
    el.append(this.root);
    this.ui = { chartBtn, replayBtn, play, speed, scrub, clock, prev, next, tradeLbl };

    // ---- chart over a delegating feed (Chart mode = static, Replay mode = replay)
    this.active = this.staticFeed;
    const feed: Datafeed = {
      getBars: (s, p, f, t) => this.active.getBars(s, p, f, t),
      subscribe: (s, p, cb) => this.active.subscribe(s, p, cb),
      getRange: (s, p) => this.active.getRange?.(s, p) ?? null,
    };
    this.chart = new ChartController(chartEl, {
      datafeed: feed, theme, timezone: opts.timezone, precision: opts.precision, autoResize: true,
    });

    // ---- wiring
    chartBtn.onclick = () => void this.setMode("chart");
    replayBtn.onclick = () => void this.setMode("replay");
    play.onclick = () => this.replay?.toggle();
    step.onclick = () => this.replay?.step(1);
    toStart.onclick = () => this.replay?.seek(this.defaultReplayStart());
    speed.onchange = () => { this.speed = Number(speed.value); this.replay?.setSpeed(this.speed); };
    scrub.oninput = () => { this.clockText(Number(scrub.value)); };
    scrub.onchange = () => this.replay?.seek(Number(scrub.value));
    prev.onclick = () => void this.gotoTrade(this.tradeIdx - 1);
    next.onclick = () => void this.gotoTrade(this.tradeIdx + 1);
    this.root.addEventListener("keydown", (e) => {
      if (this.mode !== "replay" || !this.replay) return;
      if (e.key === " ") { e.preventDefault(); this.replay.toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); this.replay.step(1); }
    });

    this.setBars(opts.bars, false);
    this.setAnnotations(opts);
    void this.setMode(opts.mode ?? "chart", true);
  }

  // ---- data
  /** Replace the bar series. */
  setBars(bars: Bar[] | BarColumns, reload = true): void {
    this.staticFeed.set(this.symbol, this.period, Array.isArray(bars) ? bars : barsFromColumns(bars));
    this.bars = this.staticFeed.get(this.symbol, this.period);
    this.ui.scrub.max = String(Math.max(0, this.bars.length - 1));
    if (this.mode === "replay") this.buildReplay(this.defaultReplayStart());
    if (reload) void this.chart.setSymbol(this.symbol);
  }
  /** Replace markers / positions / levels (any omitted key is left as is). */
  setAnnotations(a: BacktestAnnotations): void {
    if (a.markers) this.chart.setMarkers(a.markers);
    if (a.levels) this.chart.setLevels(a.levels);
    if (a.positions) {
      this.positions = [...a.positions].sort((x, y) => x.entryTs - y.entryTs);
      this.chart.setPositions(this.positions);
      this.tradeIdx = -1;
      this.tradeLabel();
    }
  }
  setTheme(theme: "dark" | "light"): void {
    this.root.dataset.theme = theme;
    this.chart.setTheme(theme);
    this.root.style.background = THEMES[theme].background;
  }
  setSpeed(barsPerSecond: number): void { this.speed = barsPerSecond; this.replay?.setSpeed(barsPerSecond); }

  // ---- navigation
  async setMode(mode: "chart" | "replay", initial = false): Promise<void> {
    if (mode === this.mode && !initial) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.ui.chartBtn.setAttribute("aria-pressed", String(mode === "chart"));
    this.ui.replayBtn.setAttribute("aria-pressed", String(mode === "replay"));
    if (mode === "replay") {
      this.buildReplay(this.defaultReplayStart());
    } else {
      this.teardownReplay();
      this.active = this.staticFeed;
    }
    await this.chart.setSymbol(this.symbol);
  }
  /** Bring a time into view (Chart mode) or move the replay cursor to it (Replay mode). */
  async goto(ts: number): Promise<void> {
    if (this.mode === "replay" && this.replay) this.replay.seek(ts);
    else await this.chart.jumpTo(ts);
  }
  /** Jump to the i-th trade (sorted by entry). Replay mode starts a little before its entry. */
  async gotoTrade(i: number): Promise<void> {
    if (!this.positions.length) return;
    this.tradeIdx = Math.max(0, Math.min(this.positions.length - 1, i));
    this.tradeLabel();
    const p = this.positions[this.tradeIdx];
    if (this.mode === "replay" && this.replay) {
      this.replay.pause();
      this.replay.seek(Math.max(0, this.indexOf(p.entryTs) - LEAD_BARS));
    } else {
      await this.chart.jumpTo(p.entryTs);
    }
  }
  /** The replay transport (null in Chart mode). */
  get replayFeed(): ReplayDatafeed | null { return this.replay; }

  dispose(): void {
    this.teardownReplay();
    this.chart.dispose();
    this.root.remove();
  }

  // ---- internals
  private buildReplay(start: number): void {
    this.teardownReplay();
    const r = new ReplayDatafeed(this.bars, { start, speed: this.speed });
    this.replay = r;
    this.active = r;
    this.replayUnsubs.push(attachReplay(this.chart, r), r.onState((s) => this.onReplayState(s)));
    this.onReplayState(r.state);
  }
  private teardownReplay(): void {
    for (const u of this.replayUnsubs) u();
    this.replayUnsubs = [];
    this.replay?.dispose();
    this.replay = null;
  }
  private onReplayState(s: ReplayState): void {
    this.ui.play.textContent = s.playing ? "⏸" : "▶";
    this.ui.play.setAttribute("aria-label", s.playing ? "Pause" : "Play");
    this.ui.scrub.value = String(s.index);
    this.clockText(s.index);
  }
  private clockText(index: number): void {
    const b = this.bars[index];
    this.ui.clock.textContent = b ? `${this.fmt.format(b.ts)}  ${index + 1}/${this.bars.length}` : "";
  }
  private tradeLabel(): void {
    const n = this.positions.length;
    this.ui.tradeLbl.textContent = n ? `trade ${this.tradeIdx < 0 ? "–" : this.tradeIdx + 1}/${n}` : "no trades";
    this.ui.prev.disabled = n === 0 || this.tradeIdx <= 0;
    this.ui.next.disabled = n === 0 || this.tradeIdx >= n - 1;
  }
  private indexOf(ts: number): number {
    let lo = 0, hi = this.bars.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.bars[mid].ts < ts) lo = mid + 1; else hi = mid; }
    return Math.min(lo, Math.max(0, this.bars.length - 1));
  }
  private defaultReplayStart(): number {
    if (this.replayStart != null) return this.replayStart > this.bars.length ? this.indexOf(this.replayStart) : this.replayStart;
    const first = this.positions[0];
    return first ? Math.max(0, this.indexOf(first.entryTs) - LEAD_BARS) : Math.min(this.bars.length - 1, 300);
  }
}
