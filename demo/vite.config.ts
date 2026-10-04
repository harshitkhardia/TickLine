import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The demo runs against TickLine's LIVE SOURCE (../src), not a stale dist build,
// so edits to the library hot-reload. klinecharts resolves from the demo's
// own node_modules (kept in sync with the library's pinned 9.8.12).
const src = fileURLToPath(new URL("../src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      tickline: src,
    },
  },
  server: {
    port: 5173,
  },
});
