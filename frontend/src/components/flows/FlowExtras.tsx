import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bookmark, FlaskConical, Pencil, Plus, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { bps, speed } from "@/lib/network";
import type { FlowRule, Severity } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Kpi, Modal, Segmented, UsageBar } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import Flag from "@/components/ui/Flag";
import { Checkbox, NumberInput, Select } from "@/components/ui/Controls";

export function Exporters() {
  const q = useQuery({ queryKey: ["flow-exporters"], queryFn: () => api.flows.exporters(), refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">Устройства, присылающие NetFlow v5 / v9, IPFIX (UDP 2055) или sFlow (UDP 6343). Имена и интерфейсы берутся из раздела «Устройства» — включите там «Экспорт потоков».</div>
      <Card bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>Экспортёр</th><th>Потоков/с</th><th>Трафик</th><th>Сэмплирование</th><th>За 24 ч</th><th>Последний поток</th><th /></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={7}><Skeleton className="h-10" /></td></tr>}
            {(q.data ?? []).map((e) => (
              <Fragment key={e.address}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === e.address ? null : e.address)}>
                  <td><div className="font-medium text-slate-100">{e.name}</div><div className="mono text-slate-500">{e.address}</div></td>
                  <td className="mono">{e.flows_per_second}</td><td className="mono">{bps(e.bps)}</td>
                  <td>{e.sampling_rate > 1 ? <Badge tone="amber">1:{e.sampling_rate}</Badge> : <Badge>без сэмплирования</Badge>}</td>
                  <td className="mono">{Fmt.num(e.flows_24h)}</td><td className="text-xs text-slate-400">{Fmt.ago(e.last_seen.replace(" ", "T") + "Z")}</td>
                  <td className="text-xs text-blue-300">{e.interfaces.length ? `интерфейсы ${e.interfaces.length}` : ""}</td>
                </tr>
                {open === e.address && (
                  <tr><td colSpan={7} className="bg-base-950/40">
                    <table className="table-nc">
                      <thead><tr><th>ifIndex</th><th>Интерфейс</th><th>Вход</th><th>Выход</th><th>Скорость</th><th>Загрузка</th></tr></thead>
                      <tbody>{e.interfaces.map((i) => (
                        <tr key={i.index}><td className="mono">{i.index}</td><td>{i.name}</td><td className="mono">{bps(i.in_bps)}</td><td className="mono">{bps(i.out_bps)}</td>
                          <td className="text-xs">{speed(i.speed_mbps)}</td><td className="w-36">{i.utilization != null ? <UsageBar percent={i.utilization} /> : "—"}</td></tr>
                      ))}</tbody>
                    </table>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {q.data && !q.data.length && <EmptyState title="Экспортёров нет" hint="Направьте NetFlow / IPFIX / sFlow на хост панели или включите экспорт на странице устройства" />}
      </Card>
    </div>
  );
}

const SEVERITY: Record<Severity, { label: string; tone: "red" | "amber" | "blue" }> = {
  critical: { label: "Критично", tone: "red" }, warning: { label: "Внимание", tone: "amber" }, info: { label: "Инфо", tone: "blue" },
};
const PARAM_LABEL: Record<string, string> = {
  dimensions: "Измерения (через запятую)", metric: "Метрика", operator: "Условие", threshold: "Порог (бит/с или пак/с)",
  window: "Окно, с", bps: "Порог, бит/с", pps: "Порог, пак/с", k: "Во сколько раз выше нормы (0 — не сравнивать)",
  baseline_window: "Окно нормы, с", ratio: "Доля (0…1)", mode: "Направление", ports: "Портов", hosts: "Адресов", weeks: "Недель истории",
  min_bps: "Минимальный объём, бит/с", direction: "Отклонение", minutes: "Минут без потоков", min_flows: "Минимум потоков",
  percent: "Загрузка, %", for_count: "Срабатывать после N проверок подряд", clear_count: "Снимать после N проверок без нарушения",
};
const CHOICES: Record<string, [string, string][]> = {
  metric: [["bps", "бит/с"], ["pps", "пак/с"]], operator: [[">", "больше порога"], ["<", "меньше порога"]],
  mode: [["inbound", "из интернета к нам"], ["outbound", "наше устройство сканирует"]], direction: [["up", "рост"], ["down", "падение"], ["both", "в обе стороны"]],
};

function RuleForm({ rule, onClose }: { rule: FlowRule | "new"; onClose: () => void }) {
  const kinds = useQuery({ queryKey: ["rule-kinds"], queryFn: () => api.flows.ruleKinds(), staleTime: Infinity });
  const isNew = rule === "new";
  const [kind, setKind] = useState(isNew ? "threshold" : rule.kind);
  const [name, setName] = useState(isNew ? "" : rule.name);
  const [filter, setFilter] = useState(isNew ? "" : rule.filter);
  const [severity, setSeverity] = useState<Severity>(isNew ? "warning" : rule.severity);
  const [params, setParams] = useState<Record<string, unknown>>(isNew ? {} : rule.params);
  const defaults = kinds.data?.find((k) => k.kind === kind)?.defaults ?? {};
  useEffect(() => { if (isNew) setParams({ ...defaults, for_count: 1, clear_count: 2 }); }, [kind, kinds.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => (isNew ? api.flows.createRule({ name, kind, filter, severity, params }) : api.flows.updateRule(rule.id, { name, filter, severity, params })),
    { success: "Правило сохранено", invalidate: [["flow-rules"]], onSuccess: onClose });
  const keys = [...new Set([...Object.keys(defaults), "for_count", "clear_count"])];
  return (
    <Modal open onClose={onClose} title={isNew ? "Новое правило" : `Правило: ${rule.name}`} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Тип">
          <Select value={kind} disabled={!isNew} onChange={setKind} options={(kinds.data ?? []).map((k) => ({ value: k.kind, label: k.title }))} />
        </Field>
        <Field label="Название"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kinds.data?.find((k) => k.kind === kind)?.title} /></Field>
        <Field label="Важность">
          <Segmented layoutId="rule-sev" value={severity} onChange={setSeverity} options={(["info", "warning", "critical"] as Severity[]).map((v) => ({ value: v, label: SEVERITY[v].label }))} />
        </Field>
        <Field label="Фильтр потоков" hint="язык фильтров «Визуализации», пусто — все потоки">
          <input className="input mono" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Route = vpn AND NOT RemoteCountry = RU" />
        </Field>
        {keys.map((k) => (
          <Field key={k} label={PARAM_LABEL[k] ?? k}>
            {CHOICES[k] ? <Select value={String(params[k] ?? defaults[k] ?? "")} onChange={(v) => setParams({ ...params, [k]: v })} options={CHOICES[k].map(([value, label]) => ({ value, label }))} />
              : k === "dimensions" ? <input className="input mono" value={((params[k] as string[]) ?? []).join(", ")} placeholder="LocalHost, Application"
                onChange={(e) => setParams({ ...params, [k]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                : <NumberInput value={Number(params[k] ?? defaults[k] ?? 0)} min={0} step={k === "ratio" ? 0.05 : 1} onChange={(v) => setParams({ ...params, [k]: v ?? 0 })} />}
          </Field>
        ))}
      </div>
      <div className="mt-6 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}><Save size={14} /> Сохранить</button></div>
    </Modal>
  );
}

export function Rules() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const q = useQuery({ queryKey: ["flow-rules"], queryFn: () => api.flows.rules(), refetchInterval: 30_000 });
  const [edit, setEdit] = useState<FlowRule | "new" | null>(null);
  const [testFor, setTestFor] = useState<FlowRule | null>(null);
  const toggle = useAction(({ id, enabled }: { id: number; enabled: boolean }) => api.flows.updateRule(id, { enabled }), { invalidate: [["flow-rules"]] });
  const remove = useAction((id: number) => api.flows.deleteRule(id), { success: "Правило удалено", invalidate: [["flow-rules"]] });
  const test = useAction((id: number) => api.flows.testRule(id));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 text-sm text-slate-400">Правила проверяются каждую минуту по потокам в ClickHouse; срабатывания попадают в «Алерты» и Telegram со ссылкой на нужный срез трафика.</div>
        {isAdmin && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={14} /> Правило</button>}
      </div>
      {q.error && <ErrorState error={q.error} />}
      <Card bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>Вкл.</th><th>Правило</th><th>Тип</th><th>Важность</th><th>Срабатывает</th><th>Проверено</th><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><Checkbox checked={r.enabled} disabled={!isAdmin} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} /></td>
                <td><div className="text-slate-100">{r.name}</div>{r.filter && <div className="mono max-w-[300px] truncate text-slate-500" title={r.filter}>{r.filter}</div>}</td>
                <td className="text-xs text-slate-400">{r.kind_title}</td>
                <td><Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge></td>
                <td>{r.firing ? <Badge tone="red"><AlertTriangle size={10} /> {r.firing}</Badge> : <span className="text-xs text-slate-500">нет</span>}</td>
                <td className="text-xs text-slate-400">{r.last_error ? <span className="text-amber-300" title={r.last_error}>ошибка</span> : Fmt.ago(r.last_eval_at)}</td>
                <td className="whitespace-nowrap">
                  <button className="btn-ghost btn-sm mr-1" title="Проверить сейчас" onClick={() => { setTestFor(r); test.mutate(r.id); }}><FlaskConical size={12} /></button>
                  {isAdmin && <><button className="btn-ghost btn-sm mr-1" onClick={() => setEdit(r)}><Pencil size={12} /></button>
                    <button className="btn-ghost btn-sm" onClick={async () => { if (await confirm({ title: "Удалить правило?", message: r.name, danger: true, confirmLabel: "Удалить" })) remove.mutate(r.id); }}><Trash2 size={12} /></button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && !q.data.length && <EmptyState title="Правил нет" />}
      </Card>
      {edit && <RuleForm rule={edit} onClose={() => setEdit(null)} />}
      <Modal open={!!testFor} onClose={() => setTestFor(null)} title={`Проверка: ${testFor?.name ?? ""}`} wide>
        {test.isPending ? <Skeleton className="h-24" /> : test.error ? <div className="text-sm text-amber-300">{(test.error as Error).message}</div> : (
          test.data?.length ? (
            <div className="space-y-2">{test.data.map((g) => (
              <div key={g.group} className="flex items-center gap-3 rounded-lg border border-base-700 p-3 text-sm">
                <div className="flex-1"><div className="text-slate-100">{g.label}</div><div className="text-xs text-slate-400">{g.text}</div></div>
                {g.link && <Link className="btn-ghost btn-sm" to={g.link} onClick={() => setTestFor(null)}>Трафик</Link>}
              </div>))}</div>
          ) : <EmptyState title="Сейчас условие не выполняется" />
        )}
      </Modal>
    </div>
  );
}

export function Threats() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const [hours, setHours] = useState("24");
  const q = useQuery({ queryKey: ["flow-threats", hours], queryFn: () => api.flows.threats(Number(hours)), refetchInterval: 60_000 });
  const refresh = useAction(() => api.flows.refreshThreats(), { success: (r) => `Загружено префиксов: ${r.prefixes}`, invalidate: [["flow-threats"]] });
  const d = q.data;
  const hosts = new Set((d?.contacts ?? []).map((c) => c.local)).size;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Контактов с угрозами" value={d?.contacts.length ?? 0} icon={<ShieldAlert size={16} />} tone="red" />
        <Kpi label="Затронуто устройств" value={hosts} icon={<ShieldAlert size={16} />} tone="amber" delay={0.05} />
        <Kpi label="Префиксов в списках" value={d?.status?.prefixes ?? 0} icon={<ShieldAlert size={16} />} tone="violet" delay={0.1}
          hint={d?.status?.updated_at ? `обновлено ${Fmt.ago(d.status.updated_at)}` : "списки ещё не загружены"} />
        <div className="card space-y-1 p-4 text-xs">
          {(d?.lists ?? []).map((l) => <div key={l.name} className="flex justify-between gap-2"><a className="truncate text-blue-300" href={l.terms || l.url} target="_blank" rel="noreferrer">{l.name}</a>
            <span className="mono text-slate-400">{l.enabled ? String(d?.status?.lists?.[l.name] ?? "—") : "выкл."}</span></div>)}
          {isAdmin && <button className="btn-ghost btn-sm mt-2 w-full" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}><RefreshCw size={12} className={refresh.isPending ? "animate-spin" : ""} /> Обновить списки</button>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm text-slate-400">Обмен трафиком с адресами из публичных списков FireHOL level1, Spamhaus DROP, abuse.ch Feodo Tracker. Частные сети и LAN исключены.</div>
        <Segmented layoutId="thr-h" value={hours} onChange={setHours} options={[{ value: "1", label: "1 ч" }, { value: "24", label: "24 ч" }, { value: "168", label: "7 дн" }]} />
      </div>
      {q.error && <ErrorState error={q.error} />}
      <Card bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>Устройство</th><th>Удалённый адрес</th><th>Список</th><th>Потоков</th><th>Объём</th><th>Последний</th><th /></tr></thead>
          <tbody>
            {(d?.contacts ?? []).map((c, i) => (
              <tr key={i}>
                <td><div className="text-slate-100">{c.host}</div><div className="mono text-slate-500">{c.local}</div></td>
                <td className="mono"><Flag code={c.country} /> {c.remote}<div className="max-w-[220px] truncate text-[11px] text-slate-500">{c.asname}</div></td>
                <td><Badge tone="red">{c.list}</Badge></td><td className="mono">{Fmt.num(c.flows)}</td><td className="mono">{Fmt.bytes(c.bytes)}</td>
                <td className="text-xs text-slate-400">{Fmt.ago(c.last_seen.replace(" ", "T") + "Z")}</td>
                <td><Link className="btn-ghost btn-sm" to={`/flows?tab=recent&f=${encodeURIComponent(`LocalAddr = ${c.local} AND RemoteAddr = ${c.remote}`)}`}>Потоки</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {d && !d.contacts.length && <EmptyState icon={<ShieldAlert size={22} />} title="Контактов с угрозами нет" hint={d.enabled ? "За выбранный период ни одно устройство не обменивалось трафиком с адресами из списков" : "Анализ угроз выключен в настройках"} />}
      </Card>
    </div>
  );
}

export function SavedViews({ state, onLoad }: { state: Record<string, unknown>; onLoad: (s: Record<string, unknown>) => void }) {
  const q = useQuery({ queryKey: ["flow-views"], queryFn: () => api.flows.views() });
  const [name, setName] = useState("");
  const save = useAction(() => api.flows.saveView(name, state), { success: "Представление сохранено", invalidate: [["flow-views"]], onSuccess: () => setName("") });
  const del = useAction((id: number) => api.flows.deleteView(id), { invalidate: [["flow-views"]] });
  return (
    <div>
      <div className="label flex items-center gap-1"><Bookmark size={11} /> Представления</div>
      <div className="flex gap-1">
        <input className="input !py-1 text-xs" placeholder="Сохранить текущий вид как…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-ghost btn-sm" disabled={!name} onClick={() => save.mutate(undefined)}><Save size={12} /></button>
      </div>
      {!!q.data?.length && (
        <div className="mt-2 space-y-1">
          {q.data.map((v) => (
            <div key={v.id} className="flex items-center gap-1 text-xs">
              <button className="flex-1 truncate rounded px-1.5 py-1 text-left text-blue-300 hover:bg-base-800" onClick={() => onLoad(v.state)}>{v.name}</button>
              <span className="text-slate-600">{v.owner}</span>
              {v.mine && <button className="p-0.5 text-slate-500 hover:text-red-300" onClick={() => del.mutate(v.id)}><Trash2 size={11} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
