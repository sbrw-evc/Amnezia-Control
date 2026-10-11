import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import Flag from "@/components/ui/Flag";
import type { Range } from "@/lib/types";
import { Card, Kpi, Page, PageHeader, Segmented } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import { Donut, Heatmap, TopBars, TrafficChart } from "@/components/charts/Charts";

const RANGES: { value: Range; label: string }[] = [
  { value: "1h", label: "1 ч" }, { value: "24h", label: "24 ч" }, { value: "7d", label: "7 дн" }, { value: "30d", label: "30 дн" }, { value: "90d", label: "90 дн" },
];
const PALETTE = ["#3b82f6", "#f59e0b", "#34d399", "#a78bfa", "#f472b6", "#22d3ee", "#facc15", "#fb7185"];

function exportCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob(["﻿" + rows.map((r) => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Analytics() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>("7d");
  const series = useQuery({ queryKey: ["traffic", range], queryFn: () => api.analytics.traffic(range) });
  const top = useQuery({ queryKey: ["top", range], queryFn: () => api.analytics.top(range) });
  const heat = useQuery({ queryKey: ["heatmap", range], queryFn: () => api.analytics.heatmap(range === "1h" || range === "24h" ? "7d" : range) });
  const geo = useQuery({ queryKey: ["geo", range], queryFn: () => api.analytics.geo(range) });

  const totals = useMemo(() => {
    const pts = series.data?.points ?? [];
    const rx = pts.reduce((a, p) => a + p.rx, 0);
    const tx = pts.reduce((a, p) => a + p.tx, 0);
    const peak = pts.reduce((m, p) => Math.max(m, p.rx + p.tx), 0);
    return { rx, tx, peak, active: top.data?.length ?? 0 };
  }, [series.data, top.data]);

  return (
    <Page>
      <PageHeader title="Аналитика" icon={<BarChart3 size={20} />} subtitle="Объёмы, активность и география клиентов"
        actions={<>
          <Segmented layoutId="an-range" value={range} onChange={setRange} options={RANGES} />
          <button className="btn-ghost btn-sm" disabled={!top.data} onClick={() => exportCsv(`traffic-${range}.csv`,
            [["Клиент", "Загрузка, байт", "Отдача, байт", "Всего, байт"], ...(top.data ?? []).map((r) => [r.name, r.rx, r.tx, r.total])])}>
            <Download size={14} /> CSV
          </button>
        </>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Загружено клиентами" value={totals.rx} format={(n) => Fmt.bytes(n)} icon={<span className="text-xs">↓</span>} />
        <Kpi label="Отдано клиентами" value={totals.tx} format={(n) => Fmt.bytes(n)} icon={<span className="text-xs">↑</span>} tone="amber" delay={0.05} />
        <Kpi label="Пик за интервал" value={totals.peak} format={(n) => Fmt.bytes(n)} icon={<span className="text-xs">▲</span>} tone="violet" delay={0.1} hint={series.data ? `шаг ${series.data.step}` : ""} />
        <Kpi label="Активных клиентов" value={totals.active} icon={<span className="text-xs">●</span>} tone="green" delay={0.15} hint="с трафиком за период" />
      </div>

      <Card title="Трафик через VPN">
        {series.data ? <TrafficChart points={series.data.points} height={320} /> : <Skeleton className="h-[320px]" />}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Топ клиентов">
          {top.data ? (top.data.length ? <TopBars rows={top.data} onClick={(id) => nav(`/clients/${id}`)} /> : <div className="py-12 text-center text-sm text-slate-500">Нет данных за период</div>) : <Skeleton className="h-64" />}
        </Card>
        <Card title="Активность по часам и дням недели">
          {heat.data ? <Heatmap cells={heat.data} /> : <Skeleton className="h-64" />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Подключения по странам">
          {geo.data ? <Donut data={geo.data.countries.slice(0, 8).map((c, i) => ({ name: c.country, value: c.connections, color: PALETTE[i % PALETTE.length] }))} height={260} /> : <Skeleton className="h-64" />}
        </Card>
        <Card className="xl:col-span-2" title="Страны" bodyClass="p-0">
          <table className="table-ac">
            <thead><tr><th>Страна</th><th>Подключений</th><th>Клиентов</th><th className="w-1/3">Доля</th></tr></thead>
            <tbody>
              {(geo.data?.countries ?? []).map((c) => {
                const total = geo.data!.countries.reduce((a, x) => a + x.connections, 0) || 1;
                return (
                  <tr key={c.code}>
                    <td><Flag code={c.code} /> {c.country}</td>
                    <td className="mono">{c.connections}</td>
                    <td className="mono">{c.clients}</td>
                    <td><div className="h-1.5 overflow-hidden rounded bg-base-800"><div className="h-full bg-accent" style={{ width: `${(c.connections * 100) / total}%` }} /></div></td>
                  </tr>
                );
              })}
              {geo.data && !geo.data.countries.length && <tr><td colSpan={4} className="py-8 text-center text-slate-500">Нет данных о подключениях</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </Page>
  );
}
