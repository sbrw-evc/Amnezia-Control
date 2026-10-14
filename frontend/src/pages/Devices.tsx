import { useQuery } from "@tanstack/react-query";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Cpu, HardDrive, Plus, Radar, RefreshCw, Router, Search, Server, Shield, Wifi } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { notify } from "@/lib/notify";
import { ROLE_LABEL, STATUS, uptime } from "@/lib/network";
import type { DiscoveryResult } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Kpi, Modal, Page, PageHeader, Segmented, StatusDot } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import DeviceForm, { type DevicePrefill } from "@/components/devices/DeviceForm";

export const ROLE_ICON: Record<string, ReactNode> = {
  router: <Router size={16} />, switch: <HardDrive size={16} />, firewall: <Shield size={16} />, ap: <Wifi size={16} />,
  controller: <Radar size={16} />, server: <Server size={16} />, other: <Cpu size={16} />,
};

function Discovery({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (p: DevicePrefill) => void }) {
  const [target, setTarget] = useState("192.168.0.0/24");
  const [community, setCommunity] = useState("public");
  const platforms = useQuery({ queryKey: ["device-platforms"], queryFn: () => api.devices.platforms(), staleTime: Infinity, enabled: open });
  const scan = useAction(() => api.devices.discover(target, community));
  const title = (k: string) => platforms.data?.find((p) => p.key === k)?.title ?? k;
  const rows: DiscoveryResult[] = scan.data ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Поиск устройств в сети" wide>
      <p className="mb-3 text-sm text-slate-400">Проверяет SSH, веб-интерфейс и SNMP каждого адреса и угадывает платформу. Учётные данные не нужны.</p>
      <div className="flex flex-wrap gap-2">
        <input className="input mono max-w-[220px]" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="192.168.0.0/24 или адрес" />
        <input className="input max-w-[160px]" value={community} onChange={(e) => setCommunity(e.target.value)} placeholder="SNMP community" />
        <button className="btn-primary" disabled={scan.isPending} onClick={() => scan.mutate(undefined)}><Search size={14} /> {scan.isPending ? "Сканирую…" : "Найти"}</button>
      </div>
      {scan.isPending && <Skeleton className="mt-4 h-40" />}
      {scan.data && (
        <div className="mt-4 max-h-[55vh] overflow-auto rounded-lg border border-base-700">
          <table className="table-nc">
            <thead><tr><th>Адрес</th><th>Порты</th><th>Похоже на</th><th>SNMP</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.host}>
                  <td className="mono">{r.host}{r.name && <div className="text-[11px] text-slate-500">{r.name}</div>}</td>
                  <td className="text-xs text-slate-400">{r.ports.join(", ") || "—"}</td>
                  <td>{r.platforms.length ? r.platforms.slice(0, 2).map((p) => <Badge key={p} tone="blue" className="mr-1">{title(p)}</Badge>) : <span className="text-xs text-slate-500">не определено</span>}</td>
                  <td className="max-w-[260px] truncate text-xs text-slate-500" title={r.snmp?.descr}>{r.snmp?.vendor || r.snmp?.descr || "—"}</td>
                  <td>{r.known ? <Badge tone="green">уже добавлено</Badge> :
                    <button className="btn-ghost btn-sm" onClick={() => onAdd({ host: r.host, platform: r.platforms[0] ?? "snmp", name: r.name })}><Plus size={12} /> Добавить</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="Ничего не найдено" hint="Проверьте подсеть и доступность устройств с хоста панели" />}
        </div>
      )}
    </Modal>
  );
}

export default function Devices() {
  const nav = useNavigate();
  const isAdmin = useAuth((s) => s.can("admin"));
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [form, setForm] = useState<{ open: boolean; prefill?: DevicePrefill }>({ open: false });
  const [discover, setDiscover] = useState(false);
  const [tbody] = useAutoAnimate<HTMLTableSectionElement>();
  const list = useQuery({ queryKey: ["devices"], queryFn: () => api.devices.list(), refetchInterval: 30_000 });
  useLive("devices", () => list.refetch(), []);
  const poll = useAction((id: string) => api.devices.poll(id), { invalidate: [["devices"]],
    onSuccess: (r) => (r.ok ? notify.success("Опрос выполнен") : notify.error("Устройство не ответило", r.error)) });

  const rows = useMemo(() => (list.data ?? []).filter((d) => (role === "all" || d.role === role) &&
    (!q || [d.name, d.host, d.vendor, d.facts.model, d.location, d.platform_title].join(" ").toLowerCase().includes(q.toLowerCase()))), [list.data, q, role]);
  const total = list.data?.length ?? 0;
  const up = list.data?.filter((d) => d.status === "up").length ?? 0;
  const ports = list.data?.reduce((a, d) => a + d.counts.interfaces_up, 0) ?? 0;

  return (
    <Page>
      <PageHeader title="Сетевые устройства" icon={<Router size={20} />}
        subtitle="Маршрутизаторы, коммутаторы, межсетевые экраны, точки доступа и контроллеры под управлением панели"
        actions={isAdmin && <>
          <button className="btn-ghost" onClick={() => setDiscover(true)}><Radar size={16} /> Найти в сети</button>
          <button className="btn-primary" onClick={() => setForm({ open: true })}><Plus size={16} /> Добавить</button>
        </>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Устройств" value={total} icon={<Router size={16} />} />
        <Kpi label="В сети" value={up} icon={<StatusDot on pulse={false} />} tone="green" delay={0.05} hint={total - up ? `недоступно: ${total - up}` : "все отвечают"} />
        <Kpi label="Активных портов" value={ports} icon={<HardDrive size={16} />} tone="violet" delay={0.1} />
        <Kpi label="Управляемых AP / коммутаторов" value={list.data?.reduce((a, d) => a + d.counts.children, 0) ?? 0} icon={<Wifi size={16} />} tone="amber" delay={0.15} hint="через контроллеры" />
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Имя, адрес, модель, расположение…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented layoutId="dev-role" value={role} onChange={setRole} options={[{ value: "all", label: "Все" },
          ...["router", "switch", "firewall", "ap", "controller", "server"].map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
      </div>
      {list.error && <ErrorState error={list.error} />}
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-nc min-w-[960px]">
            <thead><tr><th>Устройство</th><th>Платформа</th><th>Модель / версия</th><th>Адрес</th><th>Нагрузка</th><th>Порты</th><th>Опрос</th><th /></tr></thead>
            <tbody ref={tbody}>
              {list.isLoading && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={8}><Skeleton className="h-8" /></td></tr>)}
              {rows.map((d) => {
                const st = STATUS[d.status];
                return (
                  <tr key={d.id} className="cursor-pointer" onClick={() => nav(`/devices/${d.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="relative rounded-lg bg-base-800 p-2 text-blue-300">{ROLE_ICON[d.role] ?? ROLE_ICON.other}
                          <span className="absolute -right-1 -top-1"><StatusDot on={d.status === "up"} warn={d.status === "error"} pulse={false} /></span></div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-100">{d.name}</div>
                          <div className="text-[11px] text-slate-500">{ROLE_LABEL[d.role] ?? d.role}{d.location ? ` · ${d.location}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td><div className="text-sm text-slate-200">{d.vendor || "—"}</div><div className="text-[11px] text-slate-500">{d.platform_title}</div></td>
                    <td><div className="text-sm text-slate-200">{d.facts.model || "—"}</div><div className="text-[11px] text-slate-500">{[d.facts.os, d.facts.version].filter(Boolean).join(" ")}</div></td>
                    <td className="mono">{d.host}<div className="text-[11px] text-slate-500">{d.transport}</div></td>
                    <td className="text-xs text-slate-400">
                      {d.facts.cpu_percent != null && <div>CPU {d.facts.cpu_percent}%</div>}
                      {d.facts.memory_percent != null && <div>RAM {d.facts.memory_percent}%</div>}
                      {d.facts.uptime_seconds != null && <div>up {uptime(d.facts.uptime_seconds)}</div>}
                    </td>
                    <td className="text-xs text-slate-400">{d.counts.interfaces ? `${d.counts.interfaces_up}/${d.counts.interfaces}` : "—"}{d.counts.children ? <div>устройств: {d.counts.children}</div> : null}</td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-slate-500" title={d.last_error}>{d.last_error || (d.last_poll_at ? Fmt.ago(d.last_poll_at) : "")}</div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost btn-sm" title="Опросить сейчас" disabled={poll.isPending && poll.variables === d.id} onClick={() => poll.mutate(d.id)}>
                        <RefreshCw size={13} className={poll.isPending && poll.variables === d.id ? "animate-spin" : ""} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.data && !rows.length && <EmptyState icon={<Router size={22} />} title={total ? "Ничего не найдено" : "Устройств пока нет"}
            hint={total ? undefined : "Добавьте устройство вручную или найдите его в сети — поддерживаются MikroTik, Cisco, TP-Link/Omada, UniFi, Keenetic, OpenWrt, OPNsense, pfSense, HP/Aruba, Dell, Zyxel, Juniper, Huawei, FortiGate и любые SNMP-устройства"} />}
        </div>
      </Card>
      <DeviceForm open={form.open} prefill={form.prefill} onClose={() => setForm({ open: false })} />
      <Discovery open={discover} onClose={() => setDiscover(false)} onAdd={(p) => { setDiscover(false); setForm({ open: true, prefill: p }); }} />
    </Page>
  );
}
