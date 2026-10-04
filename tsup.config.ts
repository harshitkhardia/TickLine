import { defineConfig } from "tsup";

// Three outputs (the `build` script wipes dist/ first — configs run in parallel,
// so none of them may use `clean`):
//  1. Library (npm): core + React wrapper. klinecharts + react are peers — never bundled.
//  2. Standalone browser bundle (IIFE, global `TickLine`) WITH klinecharts inlined —
//     drop into any <script> tag / static HTML report.
//  3. Jupyter widget ESM WITH klinecharts inlined, written into the Python package.
export default defineConfig([
  {
    entry: { index: "src/index.ts", react: "src/react.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["klinecharts", "react", "react-dom"],
  },
  {
    entry: { tickline: "src/index.ts" },
    format: ["iife"],
    globalName: "TickLine",
    outDir: "dist/standalone",
    noExternal: ["klinecharts"],
    minify: true,
    sourcemap: false,
    platform: "browser",
  },
  {
    entry: { widget: "widget/anywidget.ts" },
    format: ["esm"],
    outDir: "python/tickline_widget/static",
    noExternal: ["klinecharts"],
    minify: true,
    sourcemap: false,
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
]);
