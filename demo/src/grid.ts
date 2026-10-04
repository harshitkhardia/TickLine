// Multi-chart grid demo (kb/CHARTMANAGER.md §6). TradingView-style layout picker over
// a ChartManager: one SharedDatafeed (dedup + derive-from-base), one SyncController
// (crosshair / drawings / time / dateRange), and command fan-out for symbol / interval
// / indicators. Runs standalone on the Mock feed.

import { ChartManager, periodToMs, type ChartController, type SyncConfig, type DrawTool } from "tickline";
import { createMockDatafeed } from "./adapters/MockDatafeed";

const DARK = {
  grid: { horizontal: { color: "#1c1c20" }, vertical: { color: "#1c1c20" } },
  candle: {
    bar: { upColor: "#34d399", downColor: "#ef4444", noChangeColor: "#71717a",
           upBorderColor: "#34d399", downBorderColor: "#ef4444", upWickColor: "#34d399", downWickColor: "#ef4444" },
    priceMark: { last: { line: { color: "#a78bfa" } } },
    tooltip: { text: { color: "#a1a1aa" } },
  },
  xAxis: { axisLine: { color: "#27272a" }, tickText: { color: "#a1a1aa" } },
  yAxis: { axisLine: { color: "#27272a" }, tickText: { color: "#a1a1aa" } },
  crosshair: {
    horizontal: { line: { color: "#52525b" }, text: { backgroundColor: "#27272a" } },
    vertical: { line: { color: "#52525b" }, text: { backgroundColor: "#27272a" } },
  },
};

const SYMBOLS = ["NIFTY", "BANKNIFTY", "CRUDEOIL", "GOLD"];
const DEFAULT_TF = ["1m", "5m", "15m", "1h"];

const manager = new ChartManager({
  datafeed: createMockDatafeed(),
  timezone: "Asia/Kolkata",
  theme: DARK as never,
  sync: { crosshair: true, drawings: true, indicators: true, time: true, dateRange: true, symbol: false, interval: false },
});

// ---- layout catalog (mirrors §6.5 / the TradingView picker) ----------------
interface Preset { id: string; cols: number; rows: number; count: number; areas?: string[]; }
const PRESETS: Preset[] = [
  { id: "1",    cols: 1, rows: 1, count: 1 },
  { id: "2h",   cols: 2, rows: 1, count: 2 },
  { id: "2v",   cols: 1, rows: 2, count: 2 },
  { id: "3h",   cols: 3, rows: 1, count: 3 },
  { id: "1L2R", cols: 2, rows: 2, count: 3, areas: ["a b", "a c"] },
  { id: "2x2",  cols: 2, rows: 2, count: 4 },
  { id: "1T3B", cols: 3, rows: 2, count: 4, areas: ["a a a", "b c d"] },
  { id: "4h",   cols: 4, rows: 1, count: 4 },
  { id: "3x2",  cols: 3, rows: 2, count: 6 },
  { id: "2x3",  cols: 2, rows: 3, count: 6 },
  { id: "4x2",  cols: 4, rows: 2, count: 8 },
  { id: "3x3",  cols: 3, rows: 3, count: 9 },
];
const AREA_LETTERS = "abcdefghi";

const gridEl = el("grid"), layoutsEl = el("layouts"), syncEl = el("sync");
const statusEl = el("status"), toolsEl = el("tools");
(el("data-badge")).textContent = "MOCK (in-memory)";

interface Cell { chart: ChartController; symbol: string; period: string; wrap: HTMLElement; }
let cells: Cell[] = [];
let active = 0;
const memory: { symbol: string; period: string }[] = [];

function defaultsFor(i: number, count: number): { symbol: string; period: string } {
  if (memory[i]) return memory[i];
  const half = Math.max(1, Math.ceil(count / 2));
  return { symbol: SYMBOLS[Math.floor(i / half) % SYMBOLS.length], period: DEFAULT_TF[i % 2] };
}

function buildCell(i: number, preset: Preset): Cell {
  const wrap = document.createElement("div");
  wrap.className = "cell" + (i === active ? " active" : "");
  if (preset.areas) wrap.style.gridArea = AREA_LETTERS[i];

  const def = defaultsFor(i, preset.count);
  const head = document.createElement("div");
  head.className = "cell-head";
  const symSel = selectFrom(SYMBOLS, def.symbol);
  const tfInput = document.createElement("input");
  tfInput.className = "tf"; tfInput.setAttribute("list", "tf-list"); tfInput.value = def.period;
  tfInput.title = "Interval — type any, e.g. 17m";
  head.append(symSel, tfInput, spacer());

  const body = document.createElement("div"); body.className = "cell-body";
  const chartEl = document.createElement("div");
  body.append(chartEl); wrap.append(head, body); gridEl.append(wrap);

  const chart = manager.addChart(chartEl, { symbol: def.symbol, period: def.period });
  const cell: Cell = { chart, symbol: def.symbol, period: def.period, wrap };

  wrap.addEventListener("mousedown", () => setActive(i));
  symSel.onchange = () => { cell.symbol = symSel.value; remember(i, cell); void manager.setSymbol(chart, cell.symbol); };
  tfInput.onchange = () => {
    const v = tfInput.value.trim();
    try { periodToMs(v); } catch { tfInput.value = cell.period; statusEl.textContent = `invalid interval "${v}"`; return; }
    cell.period = v; remember(i, cell); void manager.setPeriod(chart, v);
  };
  return cell;
}

function applyLayout(preset: Preset): void {
  manager.disposeAll();
  cells = [];
  gridEl.innerHTML = "";
  gridEl.style.gridTemplateColumns = `repeat(${preset.cols}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${preset.rows}, 1fr)`;
  gridEl.style.gridTemplateAreas = preset.areas ? preset.areas.map((r) => `"${r}"`).join(" ") : "";
  if (active >= preset.count) active = 0;
  for (let i = 0; i < preset.count; i++) cells.push(buildCell(i, preset));
  statusEl.textContent = `layout ${preset.id} — ${preset.count} chart${preset.count > 1 ? "s" : ""} · active #${active + 1}`;
  layoutsEl.querySelectorAll(".lay").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.id === preset.id));
}

function setActive(i: number): void {
  active = i;
  cells.forEach((c, idx) => c.wrap.classList.toggle("active", idx === i));
  statusEl.textContent = `active #${i + 1} — ${cells[i]?.symbol} ${cells[i]?.period}`;
}
function activeChart(): ChartController | undefined { return cells[active]?.chart; }
function remember(i: number, c: Cell): void { memory[i] = { symbol: c.symbol, period: c.period }; }

// ---- layout picker ---------------------------------------------------------
for (const p of PRESETS) {
  const b = document.createElement("button");
  b.className = "lay"; b.dataset.id = p.id; b.title = p.id;
  b.style.gridTemplateColumns = `repeat(${p.cols}, 1fr)`;
  b.style.gridTemplateRows = `repeat(${p.rows}, 1fr)`;
  if (p.areas) b.style.gridTemplateAreas = p.areas.map((r) => `"${r}"`).join(" ");
  for (let i = 0; i < p.count; i++) { const c = document.createElement("i"); if (p.areas) c.style.gridArea = AREA_LETTERS[i]; b.append(c); }
  b.onclick = () => applyLayout(p);
  layoutsEl.append(b);
}

// ---- sync panel (LIVE) -----------------------------------------------------
const SYNC_DIMS: { label: string; key: keyof SyncConfig }[] = [
  { label: "Symbol", key: "symbol" }, { label: "Interval", key: "interval" },
  { label: "Crosshair", key: "crosshair" }, { label: "Drawings", key: "drawings" },
  { label: "Indicators", key: "indicators" }, { label: "Time", key: "time" }, { label: "Date range", key: "dateRange" },
];
const initial = manager.getSync();
for (const { label, key } of SYNC_DIMS) {
  const l = document.createElement("label"); l.className = "tgl";
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!initial[key];
  cb.onchange = () => manager.setSync({ [key]: cb.checked } as Partial<SyncConfig>);
  l.append(cb, document.createTextNode(" " + label));
  syncEl.append(l);
}

// ---- draw toolbar + indicator button (act on the ACTIVE chart) -------------
const ICON = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
const TOOLS: { id: DrawTool; label: string; icon: string }[] = [
  { id: "trendline", label: "Trend line", icon: ICON('<line x1="4" y1="20" x2="20" y2="4"/>') },
  { id: "hline", label: "Horizontal line", icon: ICON('<line x1="3" y1="12" x2="21" y2="12"/>') },
  { id: "rect", label: "Rectangle", icon: ICON('<rect x="4" y="6" width="16" height="12" rx="1"/>') },
  { id: "fib", label: "Fibonacci", icon: ICON('<line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="19" x2="21" y2="19"/>') },
];
for (const t of TOOLS) {
  const b = document.createElement("button");
  b.className = "tool"; b.title = t.label + " (active chart)"; b.innerHTML = t.icon;
  b.onclick = () => activeChart()?.draw(t.id);
  toolsEl.append(b);
}
(el("add-ema") as HTMLButtonElement).onclick = () => {
  const c = activeChart(); if (c) manager.addIndicator(c, "EMA", "main", [20, 50]);
};

// ---- helpers ---------------------------------------------------------------
function el(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }
function selectFrom(opts: string[], value: string): HTMLSelectElement {
  const s = document.createElement("select");
  for (const o of opts) { const opt = document.createElement("option"); opt.value = o; opt.textContent = o; if (o === value) opt.selected = true; s.append(opt); }
  return s;
}
function spacer(): HTMLElement { const s = document.createElement("span"); s.className = "spacer"; return s; }

// initial layout: the user's 2×2 (NIFTY 1m/5m, BANKNIFTY 1m/5m)
applyLayout(PRESETS.find((p) => p.id === "2x2")!);

// debug hook (dev only) — lets the test harness inspect charts/sync
(window as unknown as { __grid: unknown }).__grid = { cells: () => cells, manager };
