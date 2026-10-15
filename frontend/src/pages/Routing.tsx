import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Cpu, Home, Network, Router, Server, Upload, Wifi } from "lucide-react";
import { Fragment, useRef, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { t } from "@/i18n";
import { useAuth } from "@/store/auth";
import { Badge, Card, Page, PageHeader, StatusDot } from "@/components/ui/Primitives";
import { SetupGuide } from "@/components/onboarding/Steps";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import { Donut } from "@/components/charts/Charts";
import { CustomPrefixes, RouteChecker } from "@/components/admin/RoutingTools";

/** A translated text with React nodes in place of its {placeholders}. */
const rich = (s: string, parts: Record<string, ReactNode>) =>
  s.split(/(\{\w+\})/).map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : p}</Fragment>;
  });

function Node({ icon, title, sub, ok }: { icon: ReactNode; title: string; sub: string; ok: boolean }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className="flex min-w-[150px] flex-col items-center gap-2 rounded-xl border border-base-700 bg-base-850 p-4 text-center">
      <div className="relative rounded-xl bg-base-800 p-3 text-blue-300">{icon}<span className="absolute -right-1 -top-1"><StatusDot on={ok} warn={!ok} /></span></div>
      <div className="text-sm font-medium text-fg">{title}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </motion.div>
  );
}

function Flow({ ok }: { ok: boolean }) {
  return (
    <div className="relative hidden h-1 flex-1 overflow-hidden rounded bg-base-700 md:block">
      {ok && <motion.div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent"
        animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }} />}
    </div>
  );
}

const PALETTE = ["#3b82f6", "#f59e0b", "#34d399", "#a78bfa", "#f472b6", "#22d3ee", "#facc15", "#fb7185", "#4ade80", "#60a5fa"];

export default function Routing() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ["routing"], queryFn: () => api.ops.routing(), refetchInterval: 60_000 });
  const upload = useAction((f: File) => api.ops.uploadSiteList(f), {
    success: (r) => t("Applied: {sites} sites → {prefixes} subnets", { sites: r.sites, prefixes: r.prefixes }), invalidate: [["routing"]],
  });
  const r = q.data?.router;
  const list = q.data?.site_list;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (await confirm({ title: t("Apply the site list?"), confirmLabel: t("Apply"),
      message: t("File {name} will be parsed, and the vpn-sites address list on MikroTik will be updated (a diff, without breaking routing).", { name: f.name }) }))
      upload.mutate(f);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Page>
      <PageHeader title={t("Routing")} icon={<Network size={20} />} subtitle={t("Sites from the list go through the VPN, other traffic goes through the provider")}
        actions={isAdmin && <>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><Upload size={16} /> {upload.isPending ? t("Applying…") : t("Upload ip-list.json")}</button>
        </>} />
      <SetupGuide page="routing" actions={{ upload: () => fileRef.current?.click() }} />

      {q.error && <ErrorState error={q.error} />}
      <Card title={t("Traffic path")}>
        {r ? (
          <div className="flex flex-col items-center gap-3 md:flex-row">
            <Node icon={<Wifi size={22} />} title={t("LAN devices")} sub={r.lan_cidr ?? "LAN"} ok />
            <Flow ok />
            <Node icon={<Router size={22} />} title={r.board ?? "MikroTik"} sub={r.reachable ? `RouterOS ${r.version} · CPU ${r.cpu}%` : t("no connection")} ok={r.reachable} />
            <Flow ok={!!r.tunnel_active} />
            <Node icon={<Home size={22} />} title={t("AmneziaWG gateway")} sub={`${r.gateway_ip ?? ""} · awg0`} ok={!!r.tunnel_active} />
            <Flow ok={!!r.tunnel_active} />
            <Node icon={<Server size={22} />} title={t("Amnezia server")} sub={r.vpn_host ?? "VPS"} ok={!!r.tunnel_active} />
          </div>
        ) : <Skeleton className="h-36" />}
        {r?.reachable && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {r.tunnel_active ? <Badge tone="green">{t("Route through the tunnel is active")}</Badge>
              : <Badge tone="red">{t("The tunnel is down — the backup route through the provider is in use")}</Badge>}
            <Badge>uptime {r.uptime}</Badge>
            <Badge><Cpu size={10} /> CPU {r.cpu}%</Badge>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t("to-vpn table routes")} bodyClass="p-0">
          <table className="table-nc">
            <thead><tr><th>{t("Gateway")}</th><th>{t("Distance")}</th><th>{t("State")}</th></tr></thead>
            <tbody>
              {(r?.routes ?? []).map((rt) => (
                <tr key={rt.gateway + rt.distance}>
                  <td className="mono">{rt.gateway}</td><td>{rt.distance}</td>
                  <td>{rt.active ? <Badge tone="green">{t("active")}</Badge> : <Badge>{t("backup")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2 p-[18px]">
            {(r?.mangle ?? []).map((m) => (
              <div key={m.comment} className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{m.comment.replace("amnezia: ", "")}</span>
                <span className="mono text-slate-300">{t("{n} pkts", { n: Fmt.num(m.packets) })} · {Fmt.bytes(m.bytes)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t("Site list")}>
          {list ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-base-950/60 p-2"><div className="text-lg font-semibold text-fg">{list.sites}</div><div className="text-[11px] text-slate-500">{t("sites")}</div></div>
                <div className="rounded-lg bg-base-950/60 p-2"><div className="text-lg font-semibold text-fg">{Fmt.num(list.prefixes)}</div><div className="text-[11px] text-slate-500">{t("subnets")}</div></div>
                <div className="rounded-lg bg-base-950/60 p-2"><div className="text-lg font-semibold text-fg">{list.coverage_percent}%</div><div className="text-[11px] text-slate-500">IPv4</div></div>
              </div>
              {list.site_names && <div className="max-h-40 overflow-y-auto text-xs leading-relaxed text-slate-400">{list.site_names.join(" · ")}</div>}
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              {rich(t("The router has {n} subnets. Upload ip-list.json to see the breakdown by sites and groups."), {
                n: r?.count ? <b className="text-fg">{Fmt.num(r.count)}</b> : "…" })}
            </div>
          )}
        </Card>
        <Card title={t("Site groups")}>
          {list?.groups ? <Donut data={Object.entries(list.groups).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] }))} height={240} />
            : <div className="py-10 text-center text-sm text-slate-500">{t("No data")}</div>}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <RouteChecker />
        <CustomPrefixes isAdmin={isAdmin} />
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500"><ArrowRight size={12} /> {t("All objects on the router are marked with the comment “amnezia”; the rollback is described in the Wiki.")}</div>
    </Page>
  );
}
