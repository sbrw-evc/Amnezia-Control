import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { useMemo } from "react";
import { Fmt } from "@/lib/format";
import type { HeatCell, SeriesPoint, TopRow } from "@/lib/types";

const AXIS = { axisLine: { lineStyle: { color: "#243049" } }, axisLabel: { color: "#64748b", fontSize: 11 }, splitLine: { lineStyle: { color: "#1a2438" } } };
const TOOLTIP = { backgroundColor: "#131c31", borderColor: "#243049", textStyle: { color: "#e2e8f0", fontSize: 12 } };
const BLUE = "#3b82f6";
const ORANGE = "#f59e0b";

function gradient(color: string) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: color + "66" }, { offset: 1, color: color + "00" },
  ]);
}

function Chart({ option, height = 260 }: { option: echarts.EChartsCoreOption; height?: number }) {
  return <ReactECharts option={{ backgroundColor: "transparent", animationDuration: 700, animationEasing: "cubicOut", ...option }}
    style={{ height, width: "100%" }} opts={{ renderer: "svg" }} notMerge={false} lazyUpdate />;
}

export function TrafficChart({ points, mode = "bytes", height }: { points: SeriesPoint[]; mode?: "bytes" | "rate"; height?: number }) {
  const fmt = mode === "rate" ? Fmt.rate : (v: number) => Fmt.bytes(v);
  const option = useMemo(() => ({
    grid: { left: 64, right: 16, top: 28, bottom: 28 },
    legend: { top: 0, right: 8, textStyle: { color: "#94a3b8", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => fmt(v) },
    xAxis: { type: "time", ...AXIS, splitLine: { show: false } },
    yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v) } },
    series: [
      { name: "↓ Загрузка", type: "line", smooth: true, showSymbol: false, data: points.map((p) => [p.t, p.rx]),
        lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE }, areaStyle: { color: gradient(BLUE) } },
      { name: "↑ Отдача", type: "line", smooth: true, showSymbol: false, data: points.map((p) => [p.t, p.tx]),
        lineStyle: { width: 2, color: ORANGE }, itemStyle: { color: ORANGE }, areaStyle: { color: gradient(ORANGE) } },
    ],
  }), [points, mode]);
  return <Chart option={option} height={height} />;
}

export function Sparkline({ values, color = BLUE, height = 40 }: { values: number[]; color?: string; height?: number }) {
  const option = useMemo(() => ({
    grid: { left: 0, right: 0, top: 4, bottom: 0 }, animation: false,
    xAxis: { type: "category", show: false, data: values.map((_, i) => i) }, yAxis: { type: "value", show: false },
    series: [{ type: "line", data: values, smooth: true, showSymbol: false, lineStyle: { width: 1.5, color }, areaStyle: { color: gradient(color) } }],
  }), [values, color]);
  return <Chart option={option} height={height} />;
}

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const option = useMemo(() => {
    const max = Math.max(1, ...cells.map((c) => c.bytes));
    return {
      grid: { left: 36, right: 12, top: 8, bottom: 56 },
      tooltip: { ...TOOLTIP, formatter: (p: { value: [number, number, number] }) => `${DAYS[p.value[1]]}, ${p.value[0]}:00 — ${Fmt.bytes(p.value[2])}` },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i), ...AXIS, splitArea: { show: false } },
      yAxis: { type: "category", data: DAYS, ...AXIS, inverse: true },
      visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10,
        textStyle: { color: "#64748b", fontSize: 10 }, formatter: (v: number) => Fmt.bytes(v, 0),
        inRange: { color: ["#131c31", "#1e3a8a", "#3b82f6", "#93c5fd"] } },
      series: [{ type: "heatmap", data: cells.map((c) => [c.hour, c.dow - 1, c.bytes]), itemStyle: { borderColor: "#0b1120", borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: "#fff" } } }],
    };
  }, [cells]);
  return <Chart option={option} height={270} />;
}

export function TopBars({ rows, onClick }: { rows: TopRow[]; onClick?: (id: string) => void }) {
  const data = [...rows].reverse();
  const option = useMemo(() => ({
    grid: { left: 120, right: 70, top: 4, bottom: 4 },
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => Fmt.bytes(v) },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: data.map((r) => r.name), ...AXIS, axisLabel: { color: "#cbd5e1", fontSize: 12, width: 110, overflow: "truncate" } },
    series: [
      { name: "↓", type: "bar", stack: "t", data: data.map((r) => r.rx), itemStyle: { color: BLUE, borderRadius: [0, 0, 0, 0] }, barWidth: 14 },
      { name: "↑", type: "bar", stack: "t", data: data.map((r) => r.tx), itemStyle: { color: ORANGE, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: "#94a3b8", fontSize: 11, formatter: (p: { dataIndex: number }) => Fmt.bytes(data[p.dataIndex].total) } },
    ],
  }), [rows]);
  return (
    <ReactECharts option={{ backgroundColor: "transparent", ...option }} style={{ height: Math.max(120, rows.length * 30 + 10), width: "100%" }}
      opts={{ renderer: "svg" }} onEvents={{ click: (p: { dataIndex: number }) => onClick?.(data[p.dataIndex].id) }} />
  );
}

export function Donut({ data, height = 220 }: { data: { name: string; value: number; color?: string }[]; height?: number }) {
  const option = useMemo(() => ({
    tooltip: { ...TOOLTIP, trigger: "item" },
    legend: { orient: "horizontal", bottom: 0, left: "center", type: "scroll", textStyle: { color: "#94a3b8", fontSize: 11 }, itemWidth: 10, itemHeight: 10,
      pageTextStyle: { color: "#94a3b8" } },
    series: [{ type: "pie", radius: ["50%", "74%"], center: ["50%", "44%"], avoidLabelOverlap: true,
      label: { show: false, position: "center" },
      emphasis: { scale: true, scaleSize: 6, label: { show: true, color: "#fff", fontSize: 22, fontWeight: 600,
        formatter: (p: { name: string; value: number }) => `${p.value}\n{s|${p.name}}`, rich: { s: { fontSize: 11, color: "#94a3b8", lineHeight: 18 } } } },
      itemStyle: { borderColor: "#0f172a", borderWidth: 3, borderRadius: 6 },
      data: data.map((d) => ({ ...d, itemStyle: d.color ? { color: d.color } : undefined })) }],
  }), [data]);
  return <Chart option={option} height={height} />;
}
