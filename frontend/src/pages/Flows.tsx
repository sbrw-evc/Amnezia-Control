import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, Play, Plus, Save, Trash2, Waypoints, X, ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { k, t, tServer } from "@/i18n";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { FlowQuery, FlowResult, FlowWidgetRow } from "@/lib/types";
import { Badge, Card, Kpi, Page, PageHeader, Segmented, StatusDot } from "@/components/ui/Primitives";
import { SetupGuide } from "@/components/onboarding/Steps";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import Flag from "@/components/ui/Flag";
import { Checkbox, NumberInput, Select } from "@/components/ui/Controls";
import { TrafficChart } from "@/components/charts/Charts";
import { GridCharts, SankeyChart, TimeSeriesChart, UnitFormatter, seriesColor, seriesName } from "@/components/charts/FlowCharts";
import { Exporters, Rules, SavedViews, Threats } from "@/components/flows/FlowExtras";

type Tab = "overview" | "visualize" | "recent" | "exporters" | "rules" | "threats";
const PRESETS: { value: string; label: string; seconds: number }[] = [
  { value: "15m", label: k("15 min"), seconds: 900 }, { value: "1h", label: k("1 h"), seconds: 3600 },
  { value: "6h", label: k("6 h"), seconds: 21600 }, { value: "24h", label: k("24 h"), seconds: 86400 },
  { value: "7d", label: k("7 d"), seconds: 604800 }, { value: "30d", label: k("30 d"), seconds: 2592000 },
  { value: "90d", label: k("90 d"), seconds: 7776000 }, { value: "1y", label: k("1 year"), seconds: 31536000 },
];
/** Unit names of the server's unit_label, shown in the current language. */
const UNIT_LABEL: Record<string, string> = { bps: k("bit/s"), pps: k("packets/s"), fps: k("flows/s") };
const DEFAULT: FlowQuery & { preset: string; refresh: number } = {
  preset: "6h", refresh: 0, dimensions: ["Application"], filter: "", limit: 10, limitType: "avg", unit: "bps",
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
      {!rows ? <Skeleton className="h-40" /> : !rows.length ? <div className="py-8 text-center text-sm text-slate-500">{t("No data")}</div> : (
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
        <Kpi label={t("Flows per second")} value={st?.flows_per_second ?? 0} format={(n) => n.toFixed(1)} icon={<Waypoints size={16} />}
          hint={st?.last_flow ? t("last: {ago}", { ago: Fmt.ago(st.last_flow.replace(" ", "T") + "Z") }) : t("waiting for data")} />
        <Kpi label={t("Via VPN in 24 h")} value={share.vpn} format={(n) => `${n.toFixed(1)}%`} icon={<ArrowLeftRight size={16} />} tone="violet" delay={0.05}
          hint={t("total {size}", { size: Fmt.bytes(share.total) })} />
        <Kpi label={t("Flows in the database")} value={st?.total_flows ?? 0} icon={<Waypoints size={16} />} tone="green" delay={0.1} />
        <Kpi label={t("ClickHouse size")} value={st?.disk_bytes ?? 0} format={(n) => Fmt.bytes(n)} icon={<Waypoints size={16} />} tone="amber" delay={0.15}
          hint={<span className="flex items-center gap-1"><StatusDot on={!!st?.ok} pulse={false} /> {st?.ok ? t("ClickHouse is available") : t("no connection")}</span>} />
      </div>
      <Card title={t("Traffic in 24 hours (from device flows)")}>
        {points.length > 1 ? <TrafficChart points={points} mode="rate" height={260} /> : <Skeleton className="h-[260px]" />}
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WidgetList title={t("Top sites · 1 h")} rows={d?.widgets.site} />
        <WidgetList title={t("Top AS · 1 h")} rows={d?.widgets.as} />
        <WidgetList title={t("Countries · 1 h")} rows={d?.widgets.country} render={(r) => <><Flag code={r.name} /> {r.name || "—"}</>} />
        <WidgetList title={t("Protocols · 1 h")} rows={d?.widgets.proto} />
        <WidgetList title={t("Remote ports · 1 h")} rows={d?.widgets.port} />
        <WidgetList title={t("LAN devices · 1 h")} rows={d?.widgets.device} />
        <WidgetList title={t("Applications · 1 h")} rows={d?.widgets.app} />
        <WidgetList title={t("Exporters · 1 h")} rows={d?.widgets.exporter} />
        {!!d?.widgets.threat?.length && <WidgetList title={t("Threat contacts · 1 h")} rows={d?.widgets.threat} />}
      </div>
      {d?.last_flow && (
        <Card title={t("Last flow")}>
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
    { success: t("Filter saved"), invalidate: [["flow-filters"]], onSuccess: () => setFilterName("") });
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
      <Card title={t("Parameters")} bodyClass="space-y-4 p-4">
        <div>
          <div className="label">{t("Period")}</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.value} className={clsx("chip", state.preset === p.value && "chip-on")} onClick={() => set({ preset: p.value, start: undefined, end: undefined })}>{t(p.label)}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="datetime-local" className="input !py-1.5 text-xs" value={state.preset === "custom" ? toLocal(state.start) : ""}
              onChange={(e) => set({ preset: "custom", start: new Date(e.target.value).toISOString(), end: state.end ?? new Date().toISOString() })} />
            <input type="datetime-local" className="input !py-1.5 text-xs" value={state.preset === "custom" ? toLocal(state.end) : ""}
              onChange={(e) => set({ preset: "custom", end: new Date(e.target.value).toISOString(), start: state.start ?? new Date(Date.now() - 21600_000).toISOString() })} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            <button className="btn-ghost btn-sm" title={t("Back")} onClick={() => shift(-1)}><ChevronLeft size={14} /></button>
            <button className="btn-ghost btn-sm" title={t("Zoom out")} onClick={() => shift(0)}><ZoomOut size={14} /></button>
            <button className="btn-ghost btn-sm" title={t("Forward")} onClick={() => shift(1)}><ChevronRight size={14} /></button>
            <div className="ml-auto w-[170px]">
              <Select size="sm" value={state.refresh} disabled={state.preset === "custom"} onChange={(v) => set({ refresh: v })} options={[
                { value: 0, label: t("no auto-refresh") }, { value: 10, label: t("every 10 s") }, { value: 30, label: t("every 30 s") },
                { value: 60, label: t("every minute") }, { value: 300, label: t("every 5 min") }]} />
            </div>
          </div>
        </div>

        <div>
          <div className="label">{t("Dimensions")}</div>
          <div className="space-y-1">
            {state.dimensions.map((d, i) => (
              <div key={d} className="flex items-center gap-1 rounded-md border border-base-700 bg-base-950/50 px-2 py-1 text-xs">
                <span className="flex-1 text-slate-200">{label(d)} <span className="text-slate-500">{d}</span></span>
                <button className="p-0.5 text-slate-500 hover:text-fg" onClick={() => moveDim(i, -1)}><ArrowUp size={12} /></button>
                <button className="p-0.5 text-slate-500 hover:text-fg" onClick={() => moveDim(i, 1)}><ArrowDown size={12} /></button>
                <button className="p-0.5 text-slate-500 hover:text-red-300" onClick={() => set({ dimensions: state.dimensions.filter((x) => x !== d) })}><X size={12} /></button>
              </div>
            ))}
            <div className="flex gap-1">
              <div className="min-w-0 flex-1">
                <Select size="sm" value={null} placeholder={t("+ add a dimension")} menuWidth={260}
                  onChange={(v: string) => set({ dimensions: [...state.dimensions, v] })}
                  options={available.map((f) => ({ value: f.name, label: f.label, hint: f.name }))} />
              </div>
              <button className="btn-ghost btn-sm" title={t("Reverse the order")} onClick={() => set({ dimensions: [...state.dimensions].reverse() })}><ArrowLeftRight size={12} /></button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><div className="label">{t("Limit")}</div><NumberInput value={state.limit} min={1} max={50} onChange={(v) => set({ limit: v ?? 10 })} /></div>
          <div><div className="label">{t("Top by")}</div>
            <Select value={state.limitType} onChange={(v) => set({ limitType: v })} options={[
              { value: "avg", label: t("average") }, { value: "max", label: t("peaks") }, { value: "last", label: t("latest") }]} /></div>
        </div>
        <div>
          <div className="label">{t("Units")}</div>
          <Segmented layoutId="fl-unit" value={state.unit} onChange={(v) => set({ unit: v })}
            options={[{ value: "bps", label: t("bit/s") }, { value: "pps", label: t("pkt/s") }, { value: "fps", label: t("flows/s") }]} />
        </div>
        <div>
          <div className="label">{t("Chart")}</div>
          <Segmented layoutId="fl-graph" value={state.graph} onChange={(v) => set({ graph: v })}
            options={[{ value: "stacked", label: "Stacked" }, { value: "stacked100", label: "100%" }, { value: "lines", label: "Lines" },
              { value: "grid", label: "Grid" }, { value: "sankey", label: "Sankey" }]} />
        </div>
        <div className="flex flex-col gap-2.5">
          <Checkbox checked={state.bidirectional} onChange={(v) => set({ bidirectional: v })} label={t("Bidirectional (inbound traffic goes down)")} />
          <Checkbox checked={state.previousPeriod} onChange={(v) => set({ previousPeriod: v })} label={t("Compare with the previous period")} />
        </div>

        <div>
          <div className="label flex items-center justify-between">{t("Filter")} <span className="text-[10px] text-slate-500">{t("Ctrl+Enter — apply")}</span></div>
          <textarea className="input mono min-h-[90px]" spellCheck={false} value={state.filter} onChange={(e) => set({ filter: e.target.value })}
            placeholder={"Route = vpn AND RemoteCountry IN (US, NL)\nApplication = HTTPS AND LocalHost LIKE '%iphone%'"} />
          <div className="mt-1 flex flex-wrap gap-1">
            {(fields.data ?? []).map((f) => (
              <button key={f.name} className="rounded bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-fg" title={f.label}
                onClick={() => set({ filter: (state.filter ? state.filter.trimEnd() + " AND " : "") + `${f.name} = ` })}>{f.name}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <input className="input !py-1 text-xs" placeholder={t("Filter name")} value={filterName} onChange={(e) => setFilterName(e.target.value)} />
            <button className="btn-ghost btn-sm" disabled={!filterName || !state.filter} onClick={() => saveFilter.mutate({ name: filterName, filter: state.filter })}><Save size={12} /></button>
          </div>
          {!!saved.data?.length && (
            <div className="mt-2 space-y-1">
              {saved.data.map((f) => (
                <div key={f.id} className="flex items-center gap-1 text-xs">
                  <button className="flex-1 truncate rounded px-1.5 py-1 text-left text-blue-300 hover:bg-base-800" title={f.filter} onClick={() => set({ filter: f.filter })}>{f.name}</button>
                  <span className="text-slate-600">{f.owner}</span>
                  {f.mine && <button className="p-0.5 text-slate-500 hover:text-red-300" onClick={async () => {
                    if (await confirm({ title: t("Delete the filter?"), message: f.name, danger: true, confirmLabel: t("Delete") })) deleteFilter.mutate(f.id);
                  }}><Trash2 size={11} /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
        <SavedViews state={state as unknown as Record<string, unknown>} onLoad={(v) => { const next = { ...DEFAULT, ...(v as Partial<State>) }; setState(next); apply(next); }} />
        <button className="btn-primary w-full" onClick={() => apply()}><Play size={14} /> {t("Apply")}</button>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card title={<span className="flex items-center gap-2">
          {res ? `${res.dimensions.map(label).join(" → ") || t("All traffic")} · ${UNIT_LABEL[res.unit] ? t(UNIT_LABEL[res.unit]) : tServer(res.unit_label)}` : t("Visualization")}
          {live && <Badge tone="green"><StatusDot on /> live</Badge>}
          {res?.table && res.table !== "flows" && <Badge tone="violet" className="normal-case">{t("aggregates {step}", { step: res.table === "flows_1h" ? t("1 h") : t("5 min") })}</Badge>}
        </span>}>
          {result.isFetching && !res && <Skeleton className="h-[380px]" />}
          {result.error && <ErrorState error={result.error} />}
          {res && res.graph === "sankey" && (res.links?.length ? <SankeyChart result={res} /> : <EmptyState title={t("No flows in this period")} />)}
          {res && res.graph === "grid" && <GridCharts result={res} />}
          {res && !["sankey", "grid"].includes(res.graph) && (res.series?.length ? <TimeSeriesChart result={res} /> : <EmptyState title={t("No flows in this period")} hint={t("Check that the devices send NetFlow / IPFIX / sFlow to the collector")} />)}
        </Card>
        {res && res.graph !== "sankey" && !!res.series?.length && (
          <Card bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-nc">
                <thead><tr><th /><th>{t("Series")}</th><th>{t("Min")}</th><th>{t("Max")}</th><th>{t("Last")}</th><th>{t("Average")}</th><th>{t("95th pct.")}</th><th>{t("Total")}</th></tr></thead>
                <tbody>
                  {res.series.map((s, i) => (
                    <tr key={s.name + s.direction}>
                      <td><span className="inline-block h-3 w-3 rounded-sm" style={{ background: seriesColor(s, i) }} /></td>
                      <td className="max-w-[320px] truncate text-slate-200" title={seriesName(s.name)}>{seriesName(s.name)}{res.bidirectional && <span className="ml-1 text-xs text-slate-500">{s.direction === "in" ? t("inbound") : t("outbound")}</span>}</td>
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
  const [params] = useSearchParams();
  const [filter, setFilter] = useState(params.get("f") ?? "");
  const [applied, setApplied] = useState(params.get("f") ?? "");
  const q = useQuery({ queryKey: ["flows-recent", applied], queryFn: () => api.flows.recent(applied, 200), refetchInterval: 15_000, retry: false });
  return (
    <div className="space-y-4">
      <div className="card flex gap-2 p-3">
        <input className="input mono" placeholder={t("Filter, for example: Route = vpn AND RemotePort = 443")} value={filter}
          onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setApplied(filter)} />
        <button className="btn-primary" onClick={() => setApplied(filter)}><Play size={14} /> {t("Find")}</button>
      </div>
      {q.error && <ErrorState error={q.error} />}
      <Card bodyClass="p-0">
        <div className="max-h-[70vh] overflow-auto">
          <table className="table-nc">
            <thead><tr><th>{t("Time")}</th><th>{t("Dir.")}</th><th>{t("Route")}</th><th>{t("Local")}</th><th>{t("Remote")}</th><th>{t("Application")}</th><th>{t("Site / AS")}</th><th>{t("Exporter")}</th><th>{t("Bytes")}</th></tr></thead>
            <tbody>
              {(q.data ?? []).map((f, i) => (
                <tr key={i}>
                  <td className="text-xs text-slate-400">{Fmt.dateTime(f.TimeReceived.replace(" ", "T") + "Z")}</td>
                  <td>{f.Direction === "out" ? <Badge tone="blue">↑ out</Badge> : f.Direction === "in" ? <Badge tone="amber">↓ in</Badge> : <Badge>↔ LAN</Badge>}</td>
                  <td>{f.Route === "vpn" ? <Badge tone="violet">VPN</Badge> : <Badge>direct</Badge>}</td>
                  <td className="mono">{f.LocalHost && f.LocalHost !== f.LocalAddr && <div className="font-sans text-slate-200">{f.LocalHost}</div>}{f.LocalAddr}{f.LocalPort ? `:${f.LocalPort}` : ""}</td>
                  <td className="mono"><Flag code={f.RemoteCountry} /> {f.RemoteAddr}{f.RemotePort ? `:${f.RemotePort}` : ""}
                    {f.RemoteHost && f.RemoteHost !== "—" && <div className="max-w-[200px] truncate font-sans text-[11px] text-slate-500">{f.RemoteHost}</div>}
                    {f.Threat && <Badge tone="red">{f.Threat}</Badge>}</td>
                  <td>{f.Application ?? f.Protocol}{f.Flags && <div className="mono text-[10px] text-slate-500">{f.Flags}</div>}</td>
                  <td className="max-w-[220px] truncate text-slate-400" title={f.RemoteASName}>{f.Site !== "—" && <div className="text-slate-200">{f.Site}</div>}AS{f.RemoteAS} {f.RemoteASName}</td>
                  <td className="text-xs text-slate-400">{f.Exporter}{(f.InIfName || f.OutIfName) && <div className="text-[10px] text-slate-500">{f.InIfName} → {f.OutIfName}</div>}</td>
                  <td className="mono">{Fmt.bytes(Number(f.Bytes))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && !q.data.length && <EmptyState title={t("No flows")} hint={t("Nothing matched the filter in the last hour")} />}
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
      <PageHeader title={t("Flow analysis")} icon={<Waypoints size={20} />}
        subtitle={t("NetFlow / IPFIX / sFlow from network devices → ClickHouse: who, where to, by which route and through which interface")}
        actions={<Segmented layoutId="flows-tab" value={tab} onChange={setTab} options={[
          { value: "overview", label: t("Overview") }, { value: "visualize", label: <span className="flex items-center gap-1"><Plus size={11} />{t("Visualization")}</span> },
          { value: "recent", label: t("Flows") }, { value: "exporters", label: t("Exporters") },
          { value: "rules", label: t("Rules") }, { value: "threats", label: t("Threats") },
        ]} />} />
      <SetupGuide page="flows" />
      {tab === "overview" && <Overview />}
      {tab === "visualize" && <Visualize />}
      {tab === "recent" && <Recent />}
      {tab === "exporters" && <Exporters />}
      {tab === "rules" && <Rules />}
      {tab === "threats" && <Threats />}
    </Page>
  );
}
