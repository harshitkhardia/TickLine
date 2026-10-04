// tickline/react — thin React wrapper over ChartController.
// The core is framework-neutral; this only manages the element lifecycle.

import { useEffect, useRef } from "react";
import { createChart, ChartController } from "./ChartController";
import type { ChartOptions } from "./adapters";

export interface TickLineChartProps extends ChartOptions {
  className?: string;
  style?: React.CSSProperties;
  /** Called once the controller is created; use it to drive the chart imperatively. */
  onReady?: (chart: ChartController) => void;
}

export function TickLineChart({ className, style, onReady, ...opts }: TickLineChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartController | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = createChart(elRef.current, opts);
    chartRef.current = chart;
    onReady?.(chart);
    return () => { chart.dispose(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={elRef} className={className} style={{ width: "100%", height: "100%", ...style }} />;
}

export { createChart, ChartController } from "./ChartController";
export type { ChartOptions } from "./adapters";
