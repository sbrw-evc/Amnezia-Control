import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, CalendarPlus, CheckCircle2, Clock, Gauge, HardDrive, KeyRound, MapPin, Pencil, QrCode, RotateCcw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Fmt, REASON_LABEL, STATUS_LABEL } from "@/lib/format";
import Flag from "@/components/ui/Flag";
import { useAction } from "@/lib/hooks";
import type { Range } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Kpi, Modal, Page, PageHeader, Segmented, StatusDot, UsageBar } from "@/components/ui/Primitives";
import { ErrorState, PageLoader, Skeleton } from "@/components/ui/Feedback";
import { TrafficChart } from "@/components/charts/Charts";
import ClientForm from "@/components/clients/ClientForm";
import ConfigModal from "@/components/clients/ConfigModal";
import { useClientActions } from "@/components/clients/useClientActions";

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24 ч" }, { value: "7d", label: "7 дн" }, { value: "30d", label: "30 дн" }, { value: "90d", label: "90 дн" },
];

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-base-700/50 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{children}</span>
    </div>
  );
}

export default function ClientDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const canEdit = useAuth((s) => s.can("operator"));
  const [range, setRange] = useState<Range>("7d");
  const [editing, setEditing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const client = useQuery({ queryKey: ["client", id], queryFn: () => api.clients.get(id), refetchInterval: 15_000 });
  const series = useQuery({ queryKey: ["client-traffic", id, range], queryFn: () => api.analytics.traffic(range, id) });
  const actions = useClientActions(() => nav("/clients"));
  const update = useAction((d: Parameters<typeof api.clients.update>[1]) => api.clients.update(id, d), {
    success: "Сохранено", invalidate: [["client", id], ["clients"]], onSuccess: () => setEditing(false),
  });

  if (client.isLoading) return <PageLoader />;
  if (client.error || !client.data) return <ErrorState error={client.error} />;
  const c = client.data;

  return (
    <Page>
      <button className="flex items-center gap-1 text-sm text-slate-400 hover:text-white" onClick={() => nav("/clients")}><ArrowLeft size={14} /> Клиенты</button>
      <PageHeader
        icon={<StatusDot on={c.online} />}
        title={c.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={c.status === "active" ? "green" : c.status === "blocked" ? "red" : "amber"}>
            {STATUS_LABEL[c.status]}{c.block_reason && ` · ${REASON_LABEL[c.block_reason]}`}
          </Badge>
          {c.system && <Badge tone="violet">системный шлюз</Badge>}
          {!c.managed && <Badge tone="amber">ключ не в панели</Badge>}
          <span className="mono">{c.address}</span>
          {c.tags.map((t) => <span key={t} className="text-blue-300/80">#{t}</span>)}
        </span>}
        actions={canEdit && <>
          <button className="btn-primary" disabled={!c.managed} onClick={() => setShowConfig(true)}><QrCode size={16} /> Конфиг</button>
          <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={16} /> Изменить</button>
          {c.expires_at && <button className="btn-ghost" disabled={update.isPending} onClick={() => update.mutate({
            expires_at: new Date(Math.max(Date.parse(c.expires_at!), Date.now()) + 30 * 86400000).toISOString() })}>
            <CalendarPlus size={16} /> +30 дней</button>}
          {!c.system && c.status !== "missing" && (
            <button className="btn-ghost" onClick={() => actions.toggleBlock(c)}>
              {c.status === "blocked" ? <><CheckCircle2 size={16} /> Разблокировать</> : <><Ban size={16} /> Заблокировать</>}
            </button>
          )}
          {c.status !== "missing" && <button className="btn-ghost" onClick={() => actions.reissue(c)}><RotateCcw size={16} /> Перевыпустить</button>}
          {!c.system && <button className="btn-danger" onClick={() => actions.remove(c)}><Trash2 size={16} /></button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Скорость сейчас" value={c.rate_rx + c.rate_tx} format={Fmt.rate} icon={<Gauge size={16} />} tone="amber" hint={`↓ ${Fmt.rate(c.rate_rx)} · ↑ ${Fmt.rate(c.rate_tx)}`} />
        <Kpi label="За месяц" value={c.month_rx + c.month_tx} format={(n) => Fmt.bytes(n)} icon={<HardDrive size={16} />} tone="violet" delay={0.05}
          hint={c.quota_bytes ? <UsageBar className="mt-1" percent={c.quota_percent} label={`из ${Fmt.bytes(c.quota_bytes, 0)}`} /> : "без квоты"} />
        <Kpi label="Всего" value={c.total_rx + c.total_tx} format={(n) => Fmt.bytes(n)} icon={<HardDrive size={16} />} delay={0.1}
          hint={`↓ ${Fmt.bytes(c.total_rx)} · ↑ ${Fmt.bytes(c.total_tx)}`} />
        <Kpi label="Доступ" value={c.expires_at ? Math.max(0, (Date.parse(c.expires_at) - Date.now()) / 86400000) : 0}
          format={(n) => (c.expires_at ? `${Math.ceil(n)} дн` : "∞")} icon={<Clock size={16} />} tone="green" delay={0.15}
          hint={c.expires_at ? `до ${Fmt.dateTime(c.expires_at)}` : "бессрочно"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Трафик" actions={<Segmented layoutId="client-range" value={range} onChange={setRange} options={RANGES} />}>
          {series.data ? <TrafficChart points={series.data.points} height={300} /> : <Skeleton className="h-[300px]" />}
        </Card>
        <Card title="Сведения">
          <Meta label="Владелец">{c.owner || "—"}</Meta>
          <Meta label="Контакт">{c.contact || "—"}</Meta>
          <Meta label="Последний handshake">{Fmt.ago(c.last_handshake_at)}</Meta>
          <Meta label="Endpoint"><span className="mono">{c.endpoint || "—"}</span></Meta>
          <Meta label="Локация">{c.country_code ? <><Flag code={c.country_code} /> {[c.city, c.country].filter(Boolean).join(", ")}</> : "—"}</Meta>
          <Meta label="Создан">{Fmt.dateTime(c.created_at)} · {c.created_by || "—"}</Meta>
          <Meta label="Конфиг выдавался">{Fmt.ago(c.config_downloaded_at)}</Meta>
          <Meta label="Публичный ключ"><span className="mono break-all text-[11px] text-slate-400"><KeyRound size={10} className="mr-1 inline" />{c.public_key}</span></Meta>
          {c.note && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-base-950/60 p-3 text-sm text-slate-300">{c.note}</div>}
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><MapPin size={14} /> История подключений</span>} bodyClass="p-0">
        <table className="table-ac">
          <thead><tr><th>Время</th><th>IP</th><th>Локация</th></tr></thead>
          <tbody>
            {(c.connections ?? []).map((e) => (
              <tr key={e.ts + e.ip}>
                <td className="whitespace-nowrap text-slate-400">{Fmt.dateTime(e.ts)}</td>
                <td className="mono text-slate-300">{e.ip}{e.port ? `:${e.port}` : ""}</td>
                <td><Flag code={e.country_code} /> {[e.city, e.country].filter(Boolean).join(", ") || "—"}</td>
              </tr>
            ))}
            {!c.connections?.length && <tr><td colSpan={3} className="py-8 text-center text-slate-500">Подключений пока не зафиксировано</td></tr>}
          </tbody>
        </table>
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Редактирование · ${c.name}`} wide>
        <ClientForm initial={c} submitLabel="Сохранить" busy={update.isPending} onSubmit={(d) => update.mutate(d)} />
      </Modal>
      <ConfigModal clientId={showConfig ? c.id : null} onClose={() => setShowConfig(false)} />
    </Page>
  );
}
