import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowDownUp, Gauge, HardDrive, Home, LayoutDashboard, Network, Server, ShieldAlert, Users, Wifi } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import Flag from "@/components/ui/Flag";
import { useLive } from "@/lib/live";
import type { LivePoint } from "@/lib/types";
import { Badge, Card, Kpi, Page, PageHeader, StatusDot } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import { Donut, TopBars, TrafficChart } from "@/components/charts/Charts";

function HealthTile({ icon, title, ok, detail, warn }: { icon: ReactNode; title: string; ok: boolean | undefined; detail: ReactNode; warn?: boolean }) {
  return (
    <motion.div whileHover={{ y: -2 }} className={clsx("card flex items-center gap-3 p-4", ok === false && "border-red-500/40")}>
      <div className={clsx("rounded-lg p-2", ok === false ? "bg-red-500/10 text-red-300" : warn ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300")}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-100">{title} <StatusDot on={!!ok} warn={warn} /></div>
        <div className="truncate text-xs text-slate-500">{detail}</div>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api.analytics.summary(), refetchInterval: 30_000 });
  const routing = useQuery({ queryKey: ["routing"], queryFn: () => api.ops.routing(), refetchInterval: 120_000 });
  const top = useQuery({ queryKey: ["top", "24h"], queryFn: () => api.analytics.top("24h") });
  const geo = useQuery({ queryKey: ["geo", "24h"], queryFn: () => api.analytics.geo("24h") });
  const initial = useQuery({ queryKey: ["live"], queryFn: () => api.analytics.live() });
  const [points, setPoints] = useState<LivePoint[]>([]);

  useEffect(() => { if (initial.data) setPoints(initial.data); }, [initial.data]);
  useLive("live", (p: LivePoint) => setPoints((prev) => [...prev.slice(-239), p]), []);

  const s = summary.data;
  const last = points[points.length - 1];
  const router = routing.data?.router;

  return (
    <Page>
      <PageHeader title="Обзор" icon={<LayoutDashboard size={20} />} subtitle="Состояние VPN, шлюза и трафика в реальном времени" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {s ? (
          <>
            <Kpi label="Онлайн сейчас" value={s.online} icon={<Wifi size={16} />} tone="green" hint={`из ${s.clients_active} активных клиентов`} />
            <Kpi label="Клиенты" value={s.clients_total} icon={<Users size={16} />} delay={0.05}
              hint={<>{s.clients_blocked} заблокировано{s.clients_missing ? ` · ${s.clients_missing} удалено на сервере` : ""}</>} />
            <Kpi label="Трафик сегодня" value={s.traffic_today} format={(n) => Fmt.bytes(n)} icon={<HardDrive size={16} />} tone="violet" delay={0.1}
              hint={`7 дн: ${Fmt.bytes(s.traffic_7d)} · 30 дн: ${Fmt.bytes(s.traffic_30d)}`} />
            <Kpi label="Скорость" value={(last?.rx ?? s.rate_rx) + (last?.tx ?? s.rate_tx)} format={Fmt.rate} icon={<Gauge size={16} />} tone="amber" delay={0.15}
              hint={`↓ ${Fmt.rate(last?.rx ?? s.rate_rx)} · ↑ ${Fmt.rate(last?.tx ?? s.rate_tx)}`} />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[108px]" />)}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HealthTile icon={<Server size={18} />} title="VPN-сервер" ok={s?.server_ok} detail={s?.server_ok ? "AmneziaWG отвечает" : "Нет связи по SSH"} />
        <HealthTile icon={<Home size={18} />} title="Домашний шлюз" ok={s?.gateway_online} detail={s?.gateway_online ? "Туннель LXC → VPS активен" : "Нет handshake"} />
        <HealthTile icon={<Network size={18} />} title="Маршрут на MikroTik" ok={router ? router.reachable && router.tunnel_active : undefined}
          detail={router?.reachable ? `${Fmt.num(router.count ?? 0)} подсетей · CPU ${router.cpu}%` : router?.error ?? "…"} />
        <HealthTile icon={<ShieldAlert size={18} />} title="Алерты" ok={!s?.alerts.critical} warn={!!s?.alerts.warning}
          detail={s ? `${s.alerts.critical ?? 0} крит. · ${s.alerts.warning ?? 0} предупр. · ${s.alerts.info ?? 0} инфо` : "…"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={<span className="flex items-center gap-2"><ArrowDownUp size={14} /> Пропускная способность · live</span>}
          actions={<Badge tone="green"><StatusDot on /> {points.length ? `обновлено ${Fmt.ago(last?.t)}` : "ожидание данных"}</Badge>}>
          {points.length > 1 ? <TrafficChart points={points} mode="rate" height={280} /> : <Skeleton className="h-[280px]" />}
        </Card>
        <Card title="Статусы клиентов">
          {s ? (
            <Donut data={[
              { name: "Онлайн", value: s.online, color: "#34d399" },
              { name: "Активны, офлайн", value: Math.max(0, s.clients_active - s.online), color: "#334160" },
              { name: "Заблокированы", value: s.clients_blocked, color: "#f87171" },
              { name: "Удалены на сервере", value: s.clients_missing, color: "#f59e0b" },
            ].filter((d) => d.value > 0)} height={280} />
          ) : <Skeleton className="h-[280px]" />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Топ по трафику · 24 ч" actions={<button className="btn-ghost btn-sm" onClick={() => nav("/analytics")}>Аналитика →</button>}>
          {top.data ? (top.data.length ? <TopBars rows={top.data} onClick={(id) => nav(`/clients/${id}`)} /> : <div className="py-10 text-center text-sm text-slate-500">Пока нет данных</div>) : <Skeleton className="h-64" />}
        </Card>
        <Card title="Последние подключения" actions={<button className="btn-ghost btn-sm" onClick={() => nav("/map")}>Карта →</button>} bodyClass="p-0">
          <div className="max-h-[320px] overflow-y-auto">
            <table className="table-ac">
              <tbody>
                {(geo.data?.recent ?? []).map((r, i) => (
                  <motion.tr key={r.ts + r.ip} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                    <td className="w-8"><Flag code={r.country_code} /></td>
                    <td><div className="text-slate-100">{r.client}</div><div className="mono text-slate-500">{r.ip}</div></td>
                    <td className="text-slate-400">{[r.city, r.country].filter(Boolean).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500">{Fmt.ago(r.ts)}</td>
                  </motion.tr>
                ))}
                {geo.data && !geo.data.recent.length && <tr><td className="py-10 text-center text-slate-500">Подключений пока нет</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  );
}
