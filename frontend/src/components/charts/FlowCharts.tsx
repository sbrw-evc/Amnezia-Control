import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { FlowResult, FlowSeries } from "@/lib/types";

export const SERIES_COLORS = ["#3b82f6", "#f59e0b", "#34d399", "#a78bfa", "#f472b6", "#22d3ee", "#facc15", "#fb7185",
  "#4ade80", "#60a5fa", "#c084fc", "#fb923c", "#2dd4bf", "#e879f9", "#a3e635"];
const OTHER = "#475569";
const AXIS = { axisLine: { lineStyle: { color: "#243049" } }, axisLabel: { color: "#64748b", fontSize: 11 }, splitLine: { lineStyle: { color: "#1a2438" } } };
const TOOLTIP = { backgroundColor: "#131c31", borderColor: "#243049", textStyle: { color: "#e2e8f0", fontSize: 12 } };

export class UnitFormatter {
  constructor(private readonly unit: string) {}

  rate(v: number): string {
    const abs = Math.abs(v);
    const [scale, suffix] = abs >= 1e9 ? [1e9, "G"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
    const base = this.unit === "bps" ? "bit/s" : this.unit === "pps" ? "pkt/s" : this.unit === "fps" ? "flow/s" : "%";
    if (this.unit === "pct") return `${v.toFixed(1)}%`;
    return `${(v / scale).toFixed(scale === 1 ? 0 : 1)} ${suffix}${base}`;
  }

  total(v: number): string {
    if (this.unit !== "bps") return `${Math.round(v).toLocaleString("ru-RU")} ${this.unit === "pps" ? "пак." : "потоков"}`;
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  }
}

export function seriesColor(s: FlowSeries, index: number): string {
  return s.name === "Прочее" ? OTHER : SERIES_COLORS[index % SERIES_COLORS.length];
}

function colorIndex(result: FlowResult): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  for (const s of result.series ?? []) {
    if (!map.has(s.name)) map.set(s.name, s.name === "Прочее" ? OTHER : SERIES_COLORS[i++ % SERIES_COLORS.length]);
  }
  return map;
}

export function TimeSeriesChart({ result, height = 380 }: { result: FlowResult; height?: number }) {
  const fmt = new UnitFormatter(result.unit);
  const option = useMemo(() => {
    const colors = colorIndex(result);
    const axis = result.axis ?? [];
    const stacked = result.graph === "stacked" || result.graph === "stacked100";
    let series = result.series ?? [];
    if (result.graph === "stacked100") {
      const totals = axis.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i]), 0) || 1);
      series = series.map((s) => ({ ...s, values: s.values.map((v, i) => (v / totals[i]) * 100) }));
    }
    const out: object[] = series.map((s) => ({
      name: s.name + (result.bidirectional && s.direction === "in" ? " ↓" : ""),
      type: "line", smooth: false, showSymbol: false, symbol: "none",
      stack: stacked ? s.direction : undefined,
      lineStyle: { width: stacked ? 0.6 : 1.6, color: colors.get(s.name) },
      itemStyle: { color: colors.get(s.name) },
      areaStyle: stacked ? { opacity: 0.85, color: colors.get(s.name) } : undefined,
      emphasis: { focus: "series" },
      data: s.values.map((v, i) => [axis[i], v]),
    }));
    if (result.previous) {
      out.push({ name: `Всего (${result.previous.label})`, type: "line", showSymbol: false, symbol: "none",
        lineStyle: { width: 1.5, type: "dashed", color: "#e2e8f0" }, itemStyle: { color: "#e2e8f0" },
        data: result.previous.values.map((v, i) => [axis[i], v]) });
    }
    const unitFmt = result.graph === "stacked100" ? (v: number) => `${v.toFixed(1)}%` : (v: number) => fmt.rate(v);
    return {
      backgroundColor: "transparent", animationDuration: 500,
      grid: { left: 80, right: 20, top: 16, bottom: 56 },
      tooltip: { ...TOOLTIP, trigger: "axis", order: "valueDesc", valueFormatter: unitFmt },
      legend: { type: "scroll", bottom: 0, textStyle: { color: "#94a3b8", fontSize: 11 }, pageTextStyle: { color: "#94a3b8" }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: "time", ...AXIS, splitLine: { show: false } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: unitFmt }, max: result.graph === "stacked100" ? 100 : undefined },
      dataZoom: [{ type: "inside" }],
      series: out,
    };
  }, [result]);
  return <ReactECharts option={option} notMerge style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} />;
}

export function GridCharts({ result }: { result: FlowResult }) {
  const fmt = new UnitFormatter(result.unit);
  const colors = colorIndex(result);
  const axis = result.axis ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(result.series ?? []).slice(0, 12).map((s) => (
        <div key={s.name + s.direction} className="rounded-lg border border-base-700 bg-base-950/40 p-2">
          <div className="flex justify-between px-1 text-xs"><span className="truncate text-slate-200" title={s.name}>{s.name}</span>
            <span className="text-slate-500">ср. {fmt.rate(s.stats.avg)}</span></div>
          <ReactECharts style={{ height: 120 }} opts={{ renderer: "svg" }} option={{
            backgroundColor: "transparent", animation: false, grid: { left: 4, right: 4, top: 8, bottom: 4 },
            tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => fmt.rate(v) },
            xAxis: { type: "time", show: false }, yAxis: { type: "value", show: false },
            series: [{ type: "line", showSymbol: false, data: s.values.map((v, i) => [axis[i], v]),
              lineStyle: { width: 1.2, color: colors.get(s.name) }, areaStyle: { opacity: 0.25, color: colors.get(s.name) } }],
          }} />
        </div>
      ))}
    </div>
  );
}

export function SankeyChart({ result, height = 460 }: { result: FlowResult; height?: number }) {
  const fmt = new UnitFormatter(result.unit);
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, trigger: "item",
      formatter: (p: { dataType: string; data: { label?: string; source?: string; target?: string; value: number } }) =>
        p.dataType === "edge"
          ? `${p.data.source?.replace(/​/g, "")} → ${p.data.target?.replace(/​/g, "")}<br/>${fmt.rate(p.data.value)}`
          : `${p.data.label}` },
    series: [{
      type: "sankey", left: 8, right: 140, top: 8, bottom: 8, nodeGap: 10, nodeWidth: 14, draggable: true,
      emphasis: { focus: "adjacency" },
      lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.35 },
      label: { color: "#cbd5e1", fontSize: 11, formatter: (p: { data: { label: string } }) => p.data.label },
      itemStyle: { borderWidth: 0 },
      levels: (result.dimensions ?? []).map((_, i) => ({ depth: i, itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] } })),
      data: (result.nodes ?? []).map((n) => ({ name: n.name, label: n.label, depth: n.depth })),
      links: result.links ?? [],
    }],
  }), [result]);
  return <ReactECharts option={option} notMerge style={{ height, width: "100%" }} />;
}
