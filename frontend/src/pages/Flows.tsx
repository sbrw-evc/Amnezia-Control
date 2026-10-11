import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, Play, Plus, Save, Trash2, Waypoints, X, ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { FlowQuery, FlowResult, FlowWidgetRow } from "@/lib/types";
import { Badge, Card, Kpi, Page, PageHeader, Segmented, StatusDot } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import Flag from "@/components/ui/Flag";
import { TrafficChart } from "@/components/charts/Charts";
import { GridCharts, SankeyChart, TimeSeriesChart, UnitFormatter, seriesColor } from "@/components/charts/FlowCharts";

type Tab = "overview" | "visualize" | "recent";
const PRESETS: { value: string; label: string; seconds: number }[] = [
  { value: "15m", label: "15 мин", seconds: 900 }, { value: "1h", label: "1 ч", seconds: 3600 },
  { value: "6h", label: "6 ч", seconds: 21600 }, { value: "24h", label: "24 ч", seconds: 86400 },
  { value: "7d", label: "7 дн", seconds: 604800 }, { value: "30d", label: "30 дн", seconds: 2592000 },
];
const DEFAULT: FlowQuery & { preset: string; refresh: number } = {
  preset: "6h", refresh: 0, dimensions: ["Site"], filter: "", limit: 10, limitType: "avg", unit: "bps",
  graph: "stacked", bidirectional: false, previousPeriod: false,
};
type State = typeof DEFAULT;

class QueryCodec {
  static encode(s: State): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
  }

  static decode(raw: string | null): State {
    if (!raw) return DEFAULT;
    try {
      return { ...DEFAULT, ...JSON.parse(decodeURIComponent(escape(atob(raw)))) };
    } catch {
      return DEFAULT;
    }
  }

  static toRequest(s: State): FlowQuery {
    const { preset, refresh, ...rest } = s;
    void refresh;
    if (preset !== "custom") {
      const p = PRESETS.find((x) => x.value === preset) ?? PRESETS[2];
      return { ...rest, start: new Date(Date.now() - p.seconds * 1000).toISOString(), end: undefined };
    }
    return rest;
  }
}

function WidgetList({ title, rows, render }: { title: string; rows: FlowWidgetRow[] | undefined; render?: (r: FlowWidgetRow) => ReactNode }) {
  return (
    <Card title={title}>
      {!rows ? <Skeleton className="h-40" /> : !rows.length ? <div className="py-8 text-center text-sm text-slate-500">Нет данных</div> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="text-sm">
              <div className="flex justify-between gap-2"><span className="truncate text-slate-200" title={r.name}>{render ? render(r) : r.name}</span>
                <span className="mono shrink-0 text-slate-400">{r.percent}%</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-base-800">
                <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${r.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ["flows-overview"], queryFn: () => api.flows.overview(), refetchInterval: 30_000 });
  const d = q.data;
  const points = useMemo(() => {
    const m = new Map<string, { t: string; rx: number; tx: number }>();
    for (const r of d?.series ?? []) {
      const p = m.get(r.t) ?? { t: r.t.replace(" ", "T") + "Z", rx: 0, tx: 0 };
      if (r.dir === "in") p.rx += r.v / 8; else p.tx += r.v / 8;
      m.set(r.t, p);
    }
    return [...m.values()];
  }, [d]);
  const share = useMemo(() => {
    const total = (d?.routes ?? []).reduce((a, r) => a + r.v, 0) || 1;
    const vpn = (d?.routes ?? []).filter((r) => r.route === "vpn").reduce((a, r) => a + r.v, 0);
    return { vpn: (vpn * 100) / total, total };
  }, [d]);
  if (q.error) return <ErrorState error={q.error} />;
  const st = d?.status;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Потоков в секунду" value={st?.flows_per_second ?? 0} format={(n) => n.toFixed(1)} icon={<Waypoints size={16} />}
          hint={st?.last_flow ? `последний: ${Fmt.ago(st.last_flow.replace(" ", "T") + "Z")}` : "ожидание данных"} />
        <Kpi label="Через VPN за 24 ч" value={share.vpn} format={(n) => `${n.toFixed(1)}%`} icon={<ArrowLeftRight size={16} />} tone="violet" delay={0.05}
          hint={`всего ${Fmt.bytes(share.total)}`} />
        <Kpi label="Потоков в базе" value={st?.total_flows ?? 0} icon={<Waypoints size={16} />} tone="green" delay={0.1} />
        <Kpi label="Объём ClickHouse" value={st?.disk_bytes ?? 0} format={(n) => Fmt.bytes(n)} icon={<Waypoints size={16} />} tone="amber" delay={0.15}
          hint={<span className="flex items-center gap-1"><StatusDot on={!!st?.ok} pulse={false} /> {st?.ok ? "ClickHouse доступен" : "нет связи"}</span>} />
      </div>
      <Card title="Трафик за 24 часа (по потокам MikroTik)">
        {points.length > 1 ? <TrafficChart points={points} mode="rate" height={260} /> : <Skeleton className="h-[260px]" />}
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WidgetList title="Топ сайтов · 1 ч" rows={d?.widgets.site} />
        <WidgetList title="Топ AS · 1 ч" rows={d?.widgets.as} />
        <WidgetList title="Страны · 1 ч" rows={d?.widgets.country} render={(r) => <><Flag code={r.name} /> {r.name || "—"}</>} />
        <WidgetList title="Протоколы · 1 ч" rows={d?.widgets.proto} />
        <WidgetList title="Удалённые порты · 1 ч" rows={d?.widgets.port} />
        <WidgetList title="Устройства LAN · 1 ч" rows={d?.widgets.device} />
      </div>
      {d?.last_flow && (
        <Card title="Последний поток">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            {Object.entries(d.last_flow).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-base-700/40 py-1"><span className="text-slate-500">{k}</span><span className="mono truncate text-slate-200">{String(v)}</span></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Visualize() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>(() => QueryCodec.decode(params.get("q")));
  const [applied, setApplied] = useState<State>(state);
  const [filterName, setFilterName] = useState("");
  const fields = useQuery({ queryKey: ["flow-fields"], queryFn: () => api.flows.fields(), staleTime: Infinity });
  const saved = useQuery({ queryKey: ["flow-filters"], queryFn: () => api.flows.filters() });
  const live = applied.preset !== "custom" && applied.refresh > 0;
  const result = useQuery({
    queryKey: ["flow-visualize", applied],
    queryFn: () => api.flows.visualize(QueryCodec.toRequest(applied)),
    refetchInterval: live ? applied.refresh * 1000 : false, refetchOnWindowFocus: false, retry: false,
  });
  const saveFilter = useAction(({ name, filter }: { name: string; filter: string }) => api.flows.saveFilter(name, filter, true),
    { success: "Фильтр сохранён", invalidate: [["flow-filters"]], onSuccess: () => setFilterName("") });
  const deleteFilter = useAction((id: number) => api.flows.deleteFilter(id), { invalidate: [["flow-filters"]] });

  const apply = (s: State = state) => {
    setApplied(s);
    setParams((p) => { p.set("q", QueryCodec.encode(s)); return p; }, { replace: true });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") apply(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const set = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const window_ = () => {
    const r = QueryCodec.toRequest(state);
    const end = r.end ? new Date(r.end) : new Date();
    return { start: new Date(r.start ?? end.getTime() - 21600_000), end };
  };
  const shift = (dir: -1 | 1 | 0) => {
    const { start, end } = window_();
    const len = end.getTime() - start.getTime();
    const s2 = dir === 0 ? new Date(start.getTime() - len / 2) : new Date(start.getTime() + dir * len);
    const e2 = dir === 0 ? new Date(end.getTime() + len / 2) : new Date(end.getTime() + dir * len);
    const next = { ...state, preset: "custom", start: s2.toISOString(), end: (e2 > new Date() ? new Date() : e2).toISOString() };
    setState(next);
    apply(next);
  };
  const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const moveDim = (i: number, d: -1 | 1) => {
    const dims = [...state.dimensions];
    const j = i + d;
    if (j < 0 || j >= dims.length) return;
    [dims[i], dims[j]] = [dims[j], dims[i]];
    set({ dimensions: dims });
  };
  const available = (fields.data ?? []).filter((f) => !state.dimensions.includes(f.name));
  const label = (name: string) => fields.data?.find((f) => f.name === name)?.label ?? name;
  const res: FlowResult | undefined = result.data;
  const fmt = new UnitFormatter(res?.unit ?? state.unit);

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <Card title="Параметры" bodyClass="space-y-4 p-4">
        <div>
          <div className="label">Период</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.value} className={clsx("chip", state.preset === p.value && "chip-on")} onClick={() => set({ preset: p.value, start: undefined, end: undefined })}>{p.label}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="datetime-local" className="input !py-1.5 text-xs" value={state.preset === "custom" ? toLocal(state.start) : ""}
              onChange={(e) => set({ preset: "custom", start: new Date(e.target.value).toISOString(), end: state.end ?? new Date().toISOString() })} />
            <input type="datetime-local" className="input !py-1.5 text-xs" value={state.preset === "custom" ? toLocal(state.end) : ""}
              onChange={(e) => set({ preset: "custom", end: new Date(e.target.value).toISOString(), start: state.start ?? new Date(Date.now() - 21600_000).toISOString() })} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            <button className="btn-ghost btn-sm" title="Назад" onClick={() => shift(-1)}><ChevronLeft size={14} /></button>
            <button className="btn-ghost btn-sm" title="Отдалить" onClick={() => shift(0)}><ZoomOut size={14} /></button>
            <button className="btn-ghost btn-sm" title="Вперёд" onClick={() => shift(1)}><ChevronRight size={14} /></button>
            <select className="input ml-auto !w-auto !py-1 text-xs" value={state.refresh} disabled={state.preset === "custom"}
              onChange={(e) => set({ refresh: Number(e.target.value) })}>
              <option value={0}>без автообновления</option><option value={10}>каждые 10 с</option><option value={30}>каждые 30 с</option>
              <option value={60}>каждую минуту</option><option value={300}>каждые 5 мин</option>
            </select>
          </div>
        </div>

        <div>
          <div className="label">Измерения</div>
          <div className="space-y-1">
            {state.dimensions.map((d, i) => (
              <div key={d} className="flex items-center gap-1 rounded-md border border-base-700 bg-base-950/50 px-2 py-1 text-xs">
                <span className="flex-1 text-slate-200">{label(d)} <span className="text-slate-500">{d}</span></span>
                <button className="p-0.5 text-slate-500 hover:text-white" onClick={() => moveDim(i, -1)}><ArrowUp size={12} /></button>
                <button className="p-0.5 text-slate-500 hover:text-white" onClick={() => moveDim(i, 1)}><ArrowDown size={12} /></button>
                <button className="p-0.5 text-slate-500 hover:text-red-300" onClick={() => set({ dimensions: state.dimensions.filter((x) => x !== d) })}><X size={12} /></button>
              </div>
            ))}
            <div className="flex gap-1">
              <select className="input !py-1 text-xs" value="" onChange={(e) => e.target.value && set({ dimensions: [...state.dimensions, e.target.value] })}>
                <option value="">+ добавить измерение</option>
                {available.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
              </select>
              <button className="btn-ghost btn-sm" title="Развернуть порядок" onClick={() => set({ dimensions: [...state.dimensions].reverse() })}><ArrowLeftRight size={12} /></button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><div className="label">Лимит</div><input type="number" min={1} max={50} className="input !py-1.5" value={state.limit} onChange={(e) => set({ limit: Number(e.target.value) || 10 })} /></div>
          <div><div className="label">Топ по</div>
            <select className="input !py-1.5" value={state.limitType} onChange={(e) => set({ limitType: e.target.value })}>
              <option value="avg">среднему</option><option value="max">пикам</option><option value="last">последним</option>
            </select></div>
        </div>
        <div>
          <div className="label">Единицы</div>
          <Segmented layoutId="fl-unit" value={state.unit} onChange={(v) => set({ unit: v })}
            options={[{ value: "bps", label: "бит/с" }, { value: "pps", label: "пак/с" }, { value: "fps", label: "потоков/с" }]} />
        </div>
        <div>
          <div className="label">График</div>
          <Segmented layoutId="fl-graph" value={state.graph} onChange={(v) => set({ graph: v })}
            options={[{ value: "stacked", label: "Stacked" }, { value: "stacked100", label: "100%" }, { value: "lines", label: "Lines" },
              { value: "grid", label: "Grid" }, { value: "sankey", label: "Sankey" }]} />
        </div>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={state.bidirectional} onChange={(e) => set({ bidirectional: e.target.checked })} /> Двунаправленный (входящий трафик — вниз)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={state.previousPeriod} onChange={(e) => set({ previousPeriod: e.target.checked })} /> Сравнить с прошлым периодом</label>
        </div>

        <div>
          <div className="label flex items-center justify-between">Фильтр <span className="text-[10px] text-slate-500">Ctrl+Enter — применить</span></div>
          <textarea className="input mono min-h-[90px]" spellCheck={false} value={state.filter} onChange={(e) => set({ filter: e.target.value })}
            placeholder={"Route = vpn AND RemoteCountry IN (US, NL)\nSite LIKE '%google%' AND NOT Proto = udp"} />
          <div className="mt-1 flex flex-wrap gap-1">
            {(fields.data ?? []).map((f) => (
              <button key={f.name} className="rounded bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white" title={f.label}
                onClick={() => set({ filter: (state.filter ? state.filter.trimEnd() + " AND " : "") + `${f.name} = ` })}>{f.name}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <input className="input !py-1 text-xs" placeholder="Название фильтра" value={filterName} onChange={(e) => setFilterName(e.target.value)} />
            <button className="btn-ghost btn-sm" disabled={!filterName || !state.filter} onClick={() => saveFilter.mutate({ name: filterName, filter: state.filter })}><Save size={12} /></button>
          </div>
          {!!saved.data?.length && (
            <div className="mt-2 space-y-1">
              {saved.data.map((f) => (
                <div key={f.id} className="flex items-center gap-1 text-xs">
                  <button className="flex-1 truncate rounded px-1.5 py-1 text-left text-blue-300 hover:bg-base-800" title={f.filter} onClick={() => set({ filter: f.filter })}>{f.name}</button>
                  <span className="text-slate-600">{f.owner}</span>
                  {f.mine && <button className="p-0.5 text-slate-500 hover:text-red-300" onClick={async () => {
                    if (await confirm({ title: "Удалить фильтр?", message: f.name, danger: true, confirmLabel: "Удалить" })) deleteFilter.mutate(f.id);
                  }}><Trash2 size={11} /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn-primary w-full" onClick={() => apply()}><Play size={14} /> Применить</button>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card title={<span className="flex items-center gap-2">
          {res ? `${res.dimensions.map(label).join(" → ") || "Весь трафик"} · ${res.unit_label}` : "Визуализация"}
          {live && <Badge tone="green"><StatusDot on /> live</Badge>}
        </span>}>
          {result.isFetching && !res && <Skeleton className="h-[380px]" />}
          {result.error && <ErrorState error={result.error} />}
          {res && res.graph === "sankey" && (res.links?.length ? <SankeyChart result={res} /> : <EmptyState title="Нет потоков за период" />)}
          {res && res.graph === "grid" && <GridCharts result={res} />}
          {res && !["sankey", "grid"].includes(res.graph) && (res.series?.length ? <TimeSeriesChart result={res} /> : <EmptyState title="Нет потоков за период" hint="Проверьте, что MikroTik отправляет NetFlow на коллектор" />)}
        </Card>
        {res && res.graph !== "sankey" && !!res.series?.length && (
          <Card bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-ac">
                <thead><tr><th /><th>Серия</th><th>Мин</th><th>Макс</th><th>Последнее</th><th>Среднее</th><th>95-й перц.</th><th>Всего</th></tr></thead>
                <tbody>
                  {res.series.map((s, i) => (
                    <tr key={s.name + s.direction}>
                      <td><span className="inline-block h-3 w-3 rounded-sm" style={{ background: seriesColor(s, i) }} /></td>
                      <td className="max-w-[320px] truncate text-slate-200" title={s.name}>{s.name}{res.bidirectional && <span className="ml-1 text-xs text-slate-500">{s.direction === "in" ? "входящий" : "исходящий"}</span>}</td>
                      <td className="mono">{fmt.rate(s.stats.min)}</td><td className="mono">{fmt.rate(s.stats.max)}</td>
                      <td className="mono">{fmt.rate(s.stats.last)}</td><td className="mono">{fmt.rate(s.stats.avg)}</td>
                      <td className="mono">{fmt.rate(s.stats.p95)}</td><td className="mono">{fmt.total(s.stats.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Recent() {
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const q = useQuery({ queryKey: ["flows-recent", applied], queryFn: () => api.flows.recent(applied, 200), refetchInterval: 15_000, retry: false });
  return (
    <div className="space-y-4">
      <div className="card flex gap-2 p-3">
        <input className="input mono" placeholder="Фильтр, например: Route = vpn AND RemotePort = 443" value={filter}
          onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setApplied(filter)} />
        <button className="btn-primary" onClick={() => setApplied(filter)}><Play size={14} /> Найти</button>
      </div>
      {q.error && <ErrorState error={q.error} />}
      <Card bodyClass="p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="table-ac">
            <thead><tr><th>Время</th><th>Напр.</th><th>Маршрут</th><th>Локальный</th><th>Удалённый</th><th>Сайт</th><th>AS</th><th>Протокол</th><th>Байт</th></tr></thead>
            <tbody>
              {(q.data ?? []).map((f, i) => (
                <tr key={i}>
                  <td className="text-xs text-slate-400">{Fmt.dateTime(f.TimeReceived.replace(" ", "T") + "Z")}</td>
                  <td>{f.Direction === "out" ? <Badge tone="blue">↑ out</Badge> : <Badge tone="amber">↓ in</Badge>}</td>
                  <td>{f.Route === "vpn" ? <Badge tone="violet">VPN</Badge> : <Badge>direct</Badge>}</td>
                  <td className="mono">{f.LocalAddr}{f.LocalPort ? `:${f.LocalPort}` : ""}</td>
                  <td className="mono"><Flag code={f.RemoteCountry} /> {f.RemoteAddr}{f.RemotePort ? `:${f.RemotePort}` : ""}</td>
                  <td>{f.Site}</td>
                  <td className="max-w-[220px] truncate text-slate-400" title={f.RemoteASName}>AS{f.RemoteAS} {f.RemoteASName}</td>
                  <td>{f.Protocol}</td>
                  <td className="mono">{Fmt.bytes(Number(f.Bytes))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && !q.data.length && <EmptyState title="Потоков нет" hint="За последний час по фильтру ничего не найдено" />}
        </div>
      </Card>
    </div>
  );
}

export default function Flows() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });
  return (
    <Page>
      <PageHeader title="Анализ потоков" icon={<Waypoints size={20} />}
        subtitle="NetFlow с MikroTik → ClickHouse: кто, куда и каким маршрутом передаёт трафик"
        actions={<Segmented layoutId="flows-tab" value={tab} onChange={setTab} options={[
          { value: "overview", label: "Обзор" }, { value: "visualize", label: <span className="flex items-center gap-1"><Plus size={11} />Визуализация</span> },
          { value: "recent", label: "Последние потоки" },
        ]} />} />
      {tab === "overview" && <Overview />}
      {tab === "visualize" && <Visualize />}
      {tab === "recent" && <Recent />}
    </Page>
  );
}
