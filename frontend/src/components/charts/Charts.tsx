import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { useMemo } from "react";
import { k, t, useLang } from "@/i18n";
import { Fmt } from "@/lib/format";
import { chartColors, useTheme } from "@/lib/theme";
import type { HeatCell, SeriesPoint, TopRow } from "@/lib/types";

type Colors = ReturnType<typeof chartColors>;

/** Axis lines, labels and split lines in the colours of the current theme. */
export function chartAxis(c: Colors) {
  return { axisLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.text, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } } };
}

/** Tooltip box in the colours of the current theme. */
export function chartTooltip(c: Colors) {
  return { backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.fg, fontSize: 12 } };
}

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
  const theme = useTheme();
  const lang = useLang();
  const fmt = mode === "rate" ? Fmt.rate : (v: number) => Fmt.bytes(v);
  const option = useMemo(() => {
    const c = chartColors();
    const AXIS = chartAxis(c);
    return {
      grid: { left: 64, right: 16, top: 28, bottom: 28 },
      legend: { top: 0, right: 8, textStyle: { color: c.text, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      tooltip: { ...chartTooltip(c), trigger: "axis", valueFormatter: (v: number) => fmt(v) },
      xAxis: { type: "time", ...AXIS, splitLine: { show: false } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v) } },
      series: [
        { name: t("↓ Download"), type: "line", smooth: true, showSymbol: false, data: points.map((p) => [p.t, p.rx]),
          lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE }, areaStyle: { color: gradient(BLUE) } },
        { name: t("↑ Upload"), type: "line", smooth: true, showSymbol: false, data: points.map((p) => [p.t, p.tx]),
          lineStyle: { width: 2, color: ORANGE }, itemStyle: { color: ORANGE }, areaStyle: { color: gradient(ORANGE) } },
      ],
    };
  }, [points, mode, theme, lang]); // eslint-disable-line react-hooks/exhaustive-deps
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

const DAYS = [k("Mon"), k("Tue"), k("Wed"), k("Thu"), k("Fri"), k("Sat"), k("Sun")];

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const theme = useTheme();
  const lang = useLang();
  const option = useMemo(() => {
    const c = chartColors();
    const AXIS = chartAxis(c);
    const days = DAYS.map((d) => t(d));
    const max = Math.max(1, ...cells.map((x) => x.bytes));
    return {
      grid: { left: 36, right: 12, top: 8, bottom: 56 },
      tooltip: { ...chartTooltip(c), formatter: (p: { value: [number, number, number] }) => `${days[p.value[1]]}, ${p.value[0]}:00 — ${Fmt.bytes(p.value[2])}` },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i), ...AXIS, splitArea: { show: false } },
      yAxis: { type: "category", data: days, ...AXIS, inverse: true },
      visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10,
        textStyle: { color: c.text, fontSize: 10 }, formatter: (v: number) => Fmt.bytes(v, 0),
        inRange: { color: theme === "dark" ? [c.grid, "#1e3a8a", "#3b82f6", "#93c5fd"] : [c.grid, "#bfdbfe", "#3b82f6", "#1e3a8a"] } },
      series: [{ type: "heatmap", data: cells.map((x) => [x.hour, x.dow - 1, x.bytes]), itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: c.fg } } }],
    };
  }, [cells, theme, lang]);
  return <Chart option={option} height={270} />;
}

export function TopBars({ rows, onClick }: { rows: TopRow[]; onClick?: (id: string) => void }) {
  const theme = useTheme();
  const data = [...rows].reverse();
  const option = useMemo(() => {
    const c = chartColors();
    return {
      grid: { left: 120, right: 70, top: 4, bottom: 4 },
      tooltip: { ...chartTooltip(c), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => Fmt.bytes(v) },
      xAxis: { type: "value", show: false },
      yAxis: { type: "category", data: data.map((r) => r.name), ...chartAxis(c), axisLabel: { color: c.fg, fontSize: 12, width: 110, overflow: "truncate" } },
      series: [
        { name: "↓", type: "bar", stack: "t", data: data.map((r) => r.rx), itemStyle: { color: BLUE, borderRadius: [0, 0, 0, 0] }, barWidth: 14 },
        { name: "↑", type: "bar", stack: "t", data: data.map((r) => r.tx), itemStyle: { color: ORANGE, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: c.text, fontSize: 11, formatter: (p: { dataIndex: number }) => Fmt.bytes(data[p.dataIndex].total) } },
      ],
    };
  }, [rows, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ReactECharts option={{ backgroundColor: "transparent", ...option }} style={{ height: Math.max(120, rows.length * 30 + 10), width: "100%" }}
      opts={{ renderer: "svg" }} onEvents={{ click: (p: { dataIndex: number }) => onClick?.(data[p.dataIndex].id) }} />
  );
}

export function Donut({ data, height = 220 }: { data: { name: string; value: number; color?: string }[]; height?: number }) {
  const theme = useTheme();
  const option = useMemo(() => {
    const c = chartColors();
    return {
      tooltip: { ...chartTooltip(c), trigger: "item" },
      legend: { orient: "horizontal", bottom: 0, left: "center", type: "scroll", textStyle: { color: c.text, fontSize: 11 }, itemWidth: 10, itemHeight: 10,
        pageTextStyle: { color: c.text } },
      series: [{ type: "pie", radius: ["50%", "74%"], center: ["50%", "44%"], avoidLabelOverlap: true,
        label: { show: false, position: "center" },
        emphasis: { scale: true, scaleSize: 6, label: { show: true, color: c.fg, fontSize: 22, fontWeight: 600,
          formatter: (p: { name: string; value: number }) => `${p.value}\n{s|${p.name}}`, rich: { s: { fontSize: 11, color: c.text, lineHeight: 18 } } } },
        itemStyle: { borderColor: c.surface, borderWidth: 3, borderRadius: 6 },
        data: data.map((d) => ({ ...d, itemStyle: d.color ? { color: d.color } : undefined })) }],
    };
  }, [data, theme]);
  return <Chart option={option} height={height} />;
}
