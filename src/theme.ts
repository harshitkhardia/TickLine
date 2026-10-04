// Theme resolution. KLineChart v9 DOES register "dark"/"light" styles, but its
// "dark" only recolours grid/axes and the canvas stays transparent — on a white
// page (or a light notebook) the result is unreadable. TickLine registers its own
// complete palettes and paints the container background itself.
//
// Both palettes set the SAME keys so switching at runtime (setTheme) fully
// overrides the previous one — v9 merges styles, it never resets them.

import type { Theme } from "./types";

interface Palette {
  bg: string; grid: string; axis: string; text: string; up: string; down: string;
  flat: string; last: string; crosshair: string; crosshairLabel: string; tooltipBg: string;
}

const DARK: Palette = {
  bg: "#0e0e11", grid: "#1c1c20", axis: "#27272a", text: "#a1a1aa", up: "#26a69a", down: "#ef5350",
  flat: "#71717a", last: "#a78bfa", crosshair: "#52525b", crosshairLabel: "#27272a", tooltipBg: "rgba(14,14,17,0.8)",
};
const LIGHT: Palette = {
  bg: "#ffffff", grid: "#f0f0f3", axis: "#d4d4d8", text: "#52525b", up: "#26a69a", down: "#ef5350",
  flat: "#a1a1aa", last: "#7c3aed", crosshair: "#a1a1aa", crosshairLabel: "#52525b", tooltipBg: "rgba(255,255,255,0.85)",
};

function toStyles(p: Palette): Record<string, unknown> {
  const axis = { axisLine: { color: p.axis }, tickLine: { color: p.axis }, tickText: { color: p.text } };
  const xhairLine = { line: { color: p.crosshair }, text: { backgroundColor: p.crosshairLabel, borderColor: p.crosshairLabel } };
  return {
    grid: { horizontal: { color: p.grid }, vertical: { color: p.grid } },
    candle: {
      bar: {
        upColor: p.up, downColor: p.down, noChangeColor: p.flat,
        upBorderColor: p.up, downBorderColor: p.down, noChangeBorderColor: p.flat,
        upWickColor: p.up, downWickColor: p.down, noChangeWickColor: p.flat,
      },
      priceMark: {
        high: { color: p.text }, low: { color: p.text },
        last: { upColor: p.up, downColor: p.down, noChangeColor: p.flat, line: { color: p.last } },
      },
      tooltip: { text: { color: p.text }, rect: { color: p.tooltipBg, borderColor: p.tooltipBg } },
    },
    indicator: { tooltip: { text: { color: p.text } } },
    xAxis: axis,
    yAxis: axis,
    separator: { color: p.axis },
    crosshair: { horizontal: xhairLine, vertical: xhairLine },
  };
}

export const THEMES: Record<"dark" | "light", { styles: Record<string, unknown>; background: string }> = {
  dark: { styles: toStyles(DARK), background: DARK.bg },
  light: { styles: toStyles(LIGHT), background: LIGHT.bg },
};

/** "dark"/"light" -> full TickLine palette + container background; an object passes
 *  through as raw v9 styles (host owns the background). */
export function resolveTheme(theme?: Theme): { styles?: Record<string, unknown>; background?: string } {
  if (theme === "dark" || theme === "light") return THEMES[theme];
  if (theme && typeof theme === "object") return { styles: theme };
  return {};
}
