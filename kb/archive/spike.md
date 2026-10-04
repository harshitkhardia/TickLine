> ⚠️ **SUPERSEDED — historical.** This is the original spike: the multi-language, engine-swappable,
> "the-JSON-protocol-is-the-product" vision (Layers 0–3, Python/Go/JS SDKs). **That direction was dropped.**
> The locked design is [ARCHITECTURE.md](ARCHITECTURE.md) — a **standalone, KLineChart-only,
> consumer-neutral** TS library (D-T1). Kept only as a record of *why* the pivot happened; do not build
> from this doc.

---

current market libraries --- KLineChart,tradingview light weight charts 
github links of different projects 


1) https://github.com/klinecharts/pro
2) https://github.com/klinecharts/KLineChart
3) https://github.com/tradingview/lightweight-charts

tradingview library info from claude

Important clarification first: TradingView Lightweight Charts does none of the Python stuff. It's a pure browser library. All the Python bridging (steps 1–3 from before) is what you add on top. Lightweight Charts only cares about one thing: drawing fast financial charts on an HTML canvas. Here's how it works internally.

1. It's a pure TypeScript/JavaScript library
Ships as a JS bundle you load in a browser (<script> tag or npm install lightweight-charts).
No DOM-heavy widgets, no React — it's framework-agnostic.
You give it a container <div>, it creates a chart inside.

const chart = LightweightCharts.createChart(document.getElementById('container'));
const series = chart.addCandlestickSeries();
series.setData([{ time: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5 }, ...]);
2. It renders with HTML5 Canvas, not SVG/DOM
This is the key to why it's "lightweight" and fast:

SVG/DOM = one element per candle → thousands of nodes → slow.
Canvas = one bitmap surface; it draws pixels directly. 100,000 candles is still one canvas element.
It actually uses multiple stacked canvas layers (one for the series/price data, one for the crosshair/overlays, one for the time/price axes) so it can redraw just the crosshair on mouse-move without repainting all the candles.
3. The data → pixel pipeline
Every frame, conceptually:

Data model — your data is stored in an internal series model (time-ordered arrays of OHLC values).
Scales — it computes two coordinate transforms:
Time scale (horizontal): maps a timestamp/bar-index → x pixel.
Price scale (vertical): maps a price value → y pixel, auto-fitting the visible min/max.
Visible range calculation — it only processes the bars currently in view (virtualization), not your whole dataset. This is why panning through millions of points stays smooth.
Renderers — each series type (candlestick, line, area, histogram) has a renderer that knows how to draw its shape given the pixel coordinates. It batches canvas draw calls (e.g. all up-candles in one color pass, all down-candles in another) to minimize state changes.
Paint — draws to the canvas, accounting for device pixel ratio so it's crisp on Retina/high-DPI screens.
4. Interaction handling
It attaches mouse/touch listeners to the container.
Pan = change the visible time range and repaint. Zoom = scale the time range.
Crosshair = on mouse-move it does an inverse transform (pixel → nearest data point) and redraws only the crosshair layer + emits a crosshairMove event.
It exposes an event/subscription API (subscribeCrosshairMove, subscribeClick, time-range change events) — this is exactly what a Python wrapper hooks into to send events back to Python.
5. The update model (why streaming is cheap)
setData() replaces everything (full recompute).
series.update(bar) adds/replaces just the last bar — it patches the data model and repaints only what changed. This is the mechanism that makes live tick streaming efficient, and the one your Tickline update() should map onto.
6. Public API surface (what you're actually wrapping)
The whole library is basically these objects:

chart — the container, axes, layout, options, events.
series — addCandlestickSeries(), addLineSeries(), addAreaSeries(), addHistogramSeries(), etc.
priceScale / timeScale — configure axes, fit content, set visible range.
markers, price lines, plugins — annotations on top of series.
How this connects back to Tickline
Your Python wrapper is essentially a remote control for this API:


Python (pandas df)
   │  serialize to JSON
   ▼
[bridge: pywebview / websocket]
   │  evaluate_js("series.setData(<json>)")
   ▼
Browser/webview running lightweight-charts.js  ← does ALL the rendering
   │  user clicks → crosshairMove event
   ▼
[bridge sends event back to Python callback]
So Lightweight Charts handles rendering, scaling, interaction, performance. Tickline handles getting Python data in and events out. You're not reimplementing any charting — you're building the pipe.

Want me to show you the actual glue JS file a wrapper injects (the small HTML+JS host page that loads lightweight-charts and exposes setData/update functions for Python to call)? That's usually the "aha" piece.


================================================================================
TICKLINE — MULTI-LANGUAGE ARCHITECTURE (Go / Python / JS, backend or frontend)
================================================================================

Reference from our own project: QuantPrime STARTED on TradingView Lightweight
Charts (decision D-002) and DROPPED it for KLineChart (D-023) because LWC has
no drawing-tools engine — hand-rolled SVG overlays for trend/fib/box/text were
fragile. Evidence lives in:
  - QuantPrime/kb/DECISIONS.md  (D-002 superseded by D-023)
  - QuantPrime/frontend/src/components/PriceChart.tsx  (real KLineChart usage)
  - QuantPrime/frontend/src/api/client.ts  (the Bar data contract)

LWC vs KLineChart for a "TradingView-style" wrapper:
  - Built-in indicators:      LWC none | KLineChart many
  - Drawing tools (fib/box):  LWC none (roll your own) | KLineChart full engine
  - License:                  LWC Apache-2.0 (attribution/logo) | KLineChart MIT
  - Brand/popularity:         LWC higher | KLineChart lower
=> For drawing tools + indicators, KLineChart is likely the better base. Decide
   consciously; don't default to LWC for the brand name.


THE KEY LESSON FROM PriceChart.tsx
----------------------------------
That file fuses THREE concerns into one React file, which is what makes it
non-portable (React-only, KLineChart-only, browser-only):
  1. Engine calls    — init, applyNewData, createIndicator, createOverlay, convertFromPixel
  2. Data contract   — Bar = {ts, open, high, low, close, volume}
  3. UI + interaction— React state, drawing toolbar, pointer handling
To go multi-language: SPLIT these apart and put a language-agnostic protocol in
the seam.


CORE IDEA: the chart engine is JS; every language is just a remote control
--------------------------------------------------------------------------
Only JS can render (must run in a browser/webview). A "Go/Python chart library"
can never BE the renderer — it only PRODUCES instructions a thin JS host runs.
Make those instructions the SAME JSON for every language => adding a language
becomes trivial.

  Layer 3 — Language SDKs (thin, one per language)
           Python / Go / JS-TS / (Rust, C#...). Job: build JSON, parse events.
                         │  Tickline Protocol (JSON) = THE PRODUCT
  Layer 2 — Transport (pluggable)
           webview eval / WebSocket / stdin-stdout / HTTP / postMessage
                         │
  Layer 1 — Tickline Host  (the ONLY JS you write; ~200 lines, framework-free)
           generic interpreter: JSON command -> engine call; event -> JSON out
                         │
  Layer 0 — Chart engine (KLineChart / Lightweight Charts)
           never changes per language; does ALL rendering.

The PROTOCOL is the product. The SDKs are disposable thin wrappers around it.


LAYER 1 — THE TICKLINE HOST (write once)
----------------------------------------
Lift the engine calls out of PriceChart.tsx and hide them behind a JSON door.
Every line below maps 1:1 to a call already in PriceChart.tsx.

  // tickline-host.js — only JS that matters; framework-free, language-free
  import { init, dispose } from "klinecharts";   // swap ENGINE here, ONE place

  let chart;
  const handlers = {
    init:            (m) => { chart = init("app", { styles: m.styles }); },
    setData:         (m) => chart.applyNewData(m.bars),
    updateData:      (m) => chart.updateData(m.bar),
    createIndicator: (m) => chart.createIndicator({ name: m.name, calcParams: m.params }, m.stack, { id: m.pane }),
    removeIndicator: (m) => chart.removeIndicator(m.pane, m.name),
    createOverlay:   (m) => chart.createOverlay({ name: m.name, points: m.points, extendData: m.text }),
    removeOverlay:   (m) => chart.removeOverlay(m.id),
  };
  function onCommand(msg) { handlers[msg.op]?.(msg); }          // commands IN
  chart.subscribeAction("onCrosshairChange", (d) =>            // events OUT
    send({ ev: "crosshair", timestamp: d.timestamp, value: d.value }));

Engine choice (KLineChart vs LWC) lives in the single import — invisible to
every language SDK.


THE TICKLINE PROTOCOL (define once, code-gen types per language)
----------------------------------------------------------------
  // command:  language -> host
  { "op":"setData", "bars":[{ "timestamp":1719700000000, "open":1,"high":2,"low":0.5,"close":1.5,"volume":100 }] }
  { "op":"createIndicator", "name":"EMA", "params":[20,50], "pane":"candle", "stack":true }
  { "op":"createOverlay", "name":"segment", "points":[{ "timestamp":1719700000000,"value":1.2 },{ "timestamp":1719760000000,"value":1.8 }] }

  // event:  host -> language
  { "ev":"crosshair", "timestamp":1719700000000, "value":1.42 }
  { "ev":"overlayCreated", "id":"overlay_3" }

Write this as ONE JSON Schema; generate Python dataclasses / Go structs / TS
interfaces from it (quicktype / datamodel-codegen). The Bar type from
client.ts becomes the canonical schema seed.


LAYER 2 — TRANSPORT decides deployment, not the API (same protocol, diff pipe)
------------------------------------------------------------------------------
  postMessage  — same-page JS object            -> frontend JS/React app
  webview eval — window.evaluate_js(json)        -> Python/Go DESKTOP (pywebview/Wails)
  WebSocket    — JSON frame                       -> Python/Go BACKEND pushing live ticks
  stdin/stdout — JSON lines                       -> CLI tools, subprocess
  HTTP POST    — request body                     -> stateless "render this chart" service


LAYER 3 — WHAT A NEW LANGUAGE SDK COSTS (~150 lines: build dict -> serialize -> send)
-------------------------------------------------------------------------------------
  # Python
  chart = Tickline(transport="webview")
  chart.set_data(df); chart.create_indicator("EMA",[20,50]); chart.show()

  // Go
  chart := tickline.New(tickline.WebSocket(":8080"))
  chart.SetData(bars); chart.CreateIndicator("EMA", []int{20,50})

  // JS/TS (talks to the host directly)
  const chart = new Tickline({ transport:"postMessage" });
  chart.setData(bars); chart.createIndicator("EMA",[20,50]);

None of them know what KLineChart is. Swap to LWC later => change Layer 1 ONLY;
every language keeps working.


BUILD ORDER
-----------
  1. FREEZE the protocol (JSON Schema for commands + events; Bar is the seed).
     Expensive to change later — design carefully.
  2. BUILD the Host (Layer 1) by lifting engine calls out of PriceChart.tsx;
     prove it with a postMessage driver in a plain HTML page.
  3. ADD one transport (WebSocket is most general — Python AND Go backends).
  4. SHIP the Python SDK first (biggest audience); Go reuses same protocol+transport.
  5. GENERATE types for all languages from the single schema.


DESIGN CAUTION (most important)
-------------------------------
Keep the protocol vocabulary in TICKLINE'S OWN terms, not KLineChart's. The
snippets above leak engine names (createOverlay, applyNewData). If the protocol
mirrors the engine API, you're permanently married to that engine. Instead
define Tickline verbs (set_data, draw, add_indicator) and TRANSLATE to the
engine inside the Host. That is what lets you switch engines (the exact LWC ->
KLineChart switch QuantPrime made) without breaking a single language binding.


OPEN DECISIONS TO MAKE
----------------------
  [ ] Base engine: KLineChart (drawing tools + indicators, MIT) vs LWC (brand, Apache-2.0)
  [ ] First transport: WebSocket (general) vs webview (desktop) 
  [ ] First SDK language: Python
  [ ] Check name availability: PyPI "tickline", npm, GitHub org


================================================================================
PRIOR ART — PUBLIC GITHUB REPOS (research 2026-07-01, TO CHECK ONCE)
================================================================================

Landscape snapshot (stars / license / last push / status):
  tradingview/lightweight-charts .......... 16.4k  Apache-2.0  2026-06  ACTIVE (first-party JS engine)
  klinecharts/KLineChart .................. 3.9k   MIT         2026-06  ACTIVE (our current engine, D-023)
  louisnw01/lightweight-charts-python ..... 2.1k   MIT         2024-09  STALLED ~22mo  <-- THIS IS BASICALLY TICKLINE
  TechfaneTechnologies/pytvlwcharts ....... 388    Apache-2.0  2024-04  STALLED (notebook/Colab)
  freyastreamlit/streamlit-lightweight..... 223    MIT         2023-07  ABANDONED (Streamlit-only)
  trash-and-fire/lwc-react-wrapper ........ -      MIT         -        React bindings

Other: tradingview/awesome-tradingview (official curated list) · official iOS/Android
wrappers · deepentropy/lightweight-charts-indicators (70+ TA indicators for LWC v5).

THE ONE THAT MATTERS: louisnw01/lightweight-charts-python
  - It IS the TickLine Python SDK, already built + 2.1k-star validated.
  - Architecture = our exact Layer 0/1/2: pywebview (embedded Chromium) hosts LWC,
    Python drives via evaluate_js, events return via callbacks.
  - Features: live tick->bar building, set()/update(), drawing toolbox (trendline/
    ray/rect/hline), subcharts/multi-pane, watchlist+order tables, hotkeys, search/TF events.
  - Frameworks: Jupyter, PyQt5/6, PySide6, wxPython, Streamlit, asyncio.
  - STRATEGIC TELL: last commit Sep 2024 (~22mo stale), 121 open issues, single
    maintainer. Popular but effectively unmaintained = the real gap.

HONEST CHALLENGE TO TICKLINE (before building):
  1. "Python wrapper for LWC" is a SOLVED (then abandoned) 2.1k-star problem.
     TickLine's only genuine novelty = (a) multi-language (Go/JS beyond Python) and
     (b) ENGINE-SWAPPABLE behind a neutral protocol (LWC <-> KLineChart). Nobody has (b).
     That is the pitch. Do NOT sell it as "another Python LWC wrapper."
  2. Protocol MUST use Tickline's own verbs, not engine verbs (createOverlay/applyNewData
     leak in the snippets above). If it mirrors the engine API, the swap differentiator
     dies and TickLine = a worse louisnw01. See DESIGN CAUTION section above.
  3. Cheapest first move: FORK louisnw01 (MIT, legal) or study its pywebview host as the
     Layer 1 reference — inherit transport/lifecycle bugs already solved across 121 issues.
     Don't build Layer 1 from zero.

NEXT: (a) deep-read louisnw01 host/transport code for Layer 1 reuse, OR
      (b) draft engine-neutral Tickline protocol verbs (fix the leak) so the swap holds.
      Start with (b) — it's what makes TickLine defensible.

