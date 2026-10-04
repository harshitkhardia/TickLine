// TickLine demo entry. Creates a chart over a Datafeed, wires the toolbar,
// indicators, crosshair status, and localStorage layout persistence.
//
// Run modes:
//   npm run demo        -> QuantPrimeDatafeed (live backend on :8000)
//   npm run demo:mock   -> MockDatafeed (in-memory random walk, no backend)

import { createChart, type ChartController, type Datafeed, type DrawTool } from "tickline";
import { createQuantPrimeDatafeed } from "./adapters/QuantPrimeDatafeed";
import { createMockDatafeed } from "./adapters/MockDatafeed";

// Minimal dark styles (KLineChart v9 has no registered "dark" style by default,
// so passing theme:"dark" alone is a no-op — pass a real styles object).
const DARK = {
  grid: { horizontal: { color: "#1c1c20" }, vertical: { color: "#1c1c20" } },
  candle: {
    bar: { upColor: "#34d399", downColor: "#ef4444", noChangeColor: "#71717a",
           upBorderColor: "#34d399", downBorderColor: "#ef4444", upWickColor: "#34d399", downWickColor: "#ef4444" },
    priceMark: { last: { line: { color: "#a78bfa" } } },
    tooltip: { text: { color: "#a1a1aa" } },
  },
  xAxis: { axisLine: { color: "#27272a" }, tickLine: { color: "#27272a" }, tickText: { color: "#a1a1aa" } },
  yAxis: { axisLine: { color: "#27272a" }, tickLine: { color: "#27272a" }, tickText: { color: "#a1a1aa" } },
  crosshair: {
    horizontal: { line: { color: "#52525b" }, text: { backgroundColor: "#27272a" } },
    vertical: { line: { color: "#52525b" }, text: { backgroundColor: "#27272a" } },
  },
};

const el = document.getElementById("chart") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const badgeEl = document.getElementById("data-badge") as HTMLSpanElement;
const symbolSel = document.getElementById("symbol") as HTMLSelectElement;
const periodSel = document.getElementById("period") as HTMLSelectElement;
const clearBtn = document.getElementById("clear-drawings") as HTMLButtonElement;

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "") === "1";

const setBadge = (mock: boolean) => {
  if (USE_MOCK) {
    badgeEl.textContent = "MOCK (in-memory)";
    badgeEl.classList.remove("live");
  } else {
    badgeEl.textContent = mock ? "MOCK — synthetic (backend)" : "LIVE";
    badgeEl.classList.toggle("live", !mock);
  }
};
setBadge(USE_MOCK);

// Build the datafeed. QP path reports its `mock` flag via callback for the badge.
const datafeed: Datafeed = USE_MOCK
  ? createMockDatafeed()
  : createQuantPrimeDatafeed({ onMockFlag: (m) => setBadge(m) });

// localStorage-backed Storage — persists drawings + layout per (symbol,period).
const storageKey = () => `tickline.layout.${symbolSel.value}.${periodSel.value}`;
const storage = {
  async load(key: string) {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  },
  async save(key: string, value: Record<string, unknown>) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const chart: ChartController = createChart(el, {
  datafeed,
  timezone: "Asia/Kolkata", // display only; bars stay UTC (D-T5)
  autoResize: true,
  theme: DARK as never,
});

// Surface any uncaught error visibly (self-diagnosing on first run).
const showError = (where: string, e: unknown) => {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  statusEl.textContent = `[${where}] ${msg}`;
  statusEl.style.color = "var(--neg)";
  console.error(`[${where}]`, e);
};
addEventListener("error", (e) => showError("window.error", e.error ?? e.message));
addEventListener("unhandledrejection", (e) => showError("promise", e.reason));

// ---- symbol / period population
["NIFTY", "BANKNIFTY", "CRUDEOIL", "GOLD"].forEach((s) => {
  const o = document.createElement("option");
  o.value = s; o.textContent = s;
  symbolSel.appendChild(o);
});
symbolSel.value = "NIFTY";

// ---- indicators
let emaOn = true, volOn = true;
let emaId: string | null = null;
let volPane: string | null = null;
let volId: string | null = null;

// Idempotent: remove what we added, then re-add per current toggles. (Indicators
// persist across applyNewData, so a plain re-add on reload would duplicate them.)
function applyIndicators(): void {
  if (emaId) { chart.removeIndicator(emaId); emaId = null; }
  if (volId) { chart.removeIndicator(volId); volId = null; }
  if (volPane) { chart.removePane(volPane); volPane = null; }
  if (emaOn) emaId = chart.addIndicator("EMA", "main", [20, 50]);
  if (volOn) { volPane = chart.createPane({ height: 120 }); volId = chart.addIndicator("VOL", volPane); }
}

// ---- drawing toolbar (built-in tools -> chart.draw(tool) interactive mode)
const ICON = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
const TOOLS: { id: DrawTool; label: string; icon: string }[] = [
  { id: "trendline", label: "Trend line", icon: ICON('<line x1="4" y1="20" x2="20" y2="4"/>') },
  { id: "hline", label: "Horizontal line", icon: ICON('<line x1="3" y1="12" x2="21" y2="12"/>') },
  { id: "vline", label: "Vertical line", icon: ICON('<line x1="12" y1="3" x2="12" y2="21"/>') },
  { id: "rect", label: "Rectangle", icon: ICON('<rect x="4" y="6" width="16" height="12" rx="1"/>') },
  { id: "fib", label: "Fibonacci", icon: ICON('<line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="19" x2="21" y2="19"/>') },
  { id: "text", label: "Text", icon: ICON('<path d="M5 5h14M12 5v14"/>') },
];
const toolsEl = document.getElementById("tools") as HTMLElement;
let activeTool: DrawTool | null = null;
for (const t of TOOLS) {
  const b = document.createElement("button");
  b.className = "tool"; b.title = t.label; b.innerHTML = t.icon;
  b.onclick = () => {
    if (activeTool === t.id) { activeTool = null; }
    else { activeTool = t.id; chart.draw(t.id); }
    document.querySelectorAll(".tool").forEach((x) => x.classList.remove("active"));
    if (activeTool) b.classList.add("active");
  };
  toolsEl.appendChild(b);
}
clearBtn.onclick = () => { chart.clearDrawings(); saveLayout(); };

// ---- crosshair -> status bar (proves the event bus is live)
chart.on("crosshairMove", (e) => {
  if (e.ts) statusEl.textContent = `crosshair @ ${new Date(e.ts).toISOString().slice(11, 19)}  ${e.value?.toFixed(2)}`;
});
chart.on("error", (e) => {
  statusEl.textContent = `error (${e.kind}/${e.op}): ${e.message}`;
  console.error("[TickLine]", e);
});

// ---- layout persistence (serialize/restore). Drawing-event wiring is a
// follow-up; for now a Save button + auto-restore on load demonstrates it.
async function saveLayout(): Promise<void> {
  const snap = chart.serialize() as unknown as Record<string, unknown>;
  await storage.save(storageKey(), snap);
}
async function loadLayout(): Promise<void> {
  const saved = await storage.load(storageKey());
  if (saved) chart.restore(saved as never);
}

// ---- automatic persistence via the drawing lifecycle events (Step 2).
// Debounced: a drag fires many drawingModified frames; coalesce into one write.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const autoSave = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void saveLayout(); }, 300);
};
chart.on("drawingCreated", autoSave);
chart.on("drawingModified", autoSave);
chart.on("drawingRemoved", autoSave);

// ---- symbol/period switches -> reload + restore layout
let loadGuard = false;
async function load(symbol: string, period: string): Promise<void> {
  if (loadGuard) return;
  loadGuard = true;
  try {
    await chart.setPeriod(period as never);
    await chart.setSymbol(symbol);
    applyIndicators();
    await loadLayout();
    statusEl.textContent = `${symbol} ${period} loaded`;
  } catch (e) {
    console.error(e);
  } finally {
    loadGuard = false;
  }
}

symbolSel.onchange = () => load(symbolSel.value, periodSel.value);
periodSel.onchange = () => load(symbolSel.value, periodSel.value);
(document.querySelectorAll(".tgl")).forEach((node) => {
  const elem = node as HTMLElement;
  const ind = elem.dataset.ind;
  const box = elem.querySelector("input") as HTMLInputElement;
  box.onchange = () => {
    if (ind === "EMA") emaOn = box.checked;
    if (ind === "VOL") volOn = box.checked;
    applyIndicators();
  };
});

// initial load
load(symbolSel.value, periodSel.value);
