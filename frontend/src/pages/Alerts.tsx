import { useQuery } from "@tanstack/react-query";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { AlertOctagon, AlertTriangle, Bell, Check, Info } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Severity } from "@/lib/types";
import { Badge, Page, PageHeader, Segmented } from "@/components/ui/Primitives";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { k, t, tServer } from "@/i18n";

const SEV: Record<Severity, { icon: JSX.Element; tone: "red" | "amber" | "blue"; label: string }> = {
  critical: { icon: <AlertOctagon size={18} />, tone: "red", label: k("Critical") },
  warning: { icon: <AlertTriangle size={18} />, tone: "amber", label: k("Warning") },
  info: { icon: <Info size={18} />, tone: "blue", label: k("Info") },
};

export default function Alerts() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"open" | "all">("open");
  const alerts = useQuery({ queryKey: ["alerts", mode], queryFn: () => api.ops.alerts(mode === "all"), refetchInterval: 30_000 });
  const ack = useAction((id: number) => api.ops.ack(id), { invalidate: [["alerts"]] });
  const [list] = useAutoAnimate<HTMLDivElement>();

  return (
    <Page>
      <PageHeader title={t("Alerts")} icon={<Bell size={20} />} subtitle={t("Device and infrastructure failures, traffic rules, client quotas and access deadlines")}
        actions={<Segmented layoutId="al-mode" value={mode} onChange={setMode} options={[{ value: "open", label: t("Open alerts") }, { value: "all", label: t("History") }]} />} />
      <div ref={list} className="space-y-2">
        {alerts.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16" />)}
        {alerts.data?.map((a) => {
          const s = SEV[a.severity];
          return (
            <div key={a.id} className={clsx("card flex items-center gap-4 p-4", a.resolved_at && "opacity-60",
              !a.resolved_at && a.severity === "critical" && "border-red-500/40 shadow-[0_0_30px_-12px_rgba(239,68,68,.5)]")}>
              <div className={clsx("rounded-lg p-2", { red: "bg-red-500/10 text-red-300", amber: "bg-amber-500/10 text-amber-300", blue: "bg-blue-500/10 text-blue-300" }[s.tone])}>{s.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-100">{tServer(a.title)}</span>
                  <Badge tone={s.tone}>{t(s.label)}</Badge>
                  {a.resolved_at && <Badge tone="green">{t("resolved {ago}", { ago: Fmt.ago(a.resolved_at) })}</Badge>}
                  {a.acknowledged_by && <Badge>{t("acknowledged by {name}", { name: a.acknowledged_by })}</Badge>}
                </div>
                {a.message && <div className="mt-0.5 text-sm text-slate-400">{tServer(a.message)}</div>}
              </div>
              <div className="text-right text-xs text-slate-500">{Fmt.dateTime(a.ts)}</div>
              <div className="flex gap-1">
                {a.target_id && a.key.startsWith("client") && <button className="btn-ghost btn-sm" onClick={() => nav(`/clients/${a.target_id}`)}>{t("Client")}</button>}
                {a.link && <button className="btn-ghost btn-sm" onClick={() => nav(a.link!)}>{a.key.startsWith("flow.") ? t("Traffic") : t("Open")}</button>}
                {!a.resolved_at && !a.acknowledged_by && <button className="btn-ghost btn-sm" onClick={() => ack.mutate(a.id)}><Check size={14} /> {t("Acknowledge")}</button>}
              </div>
            </div>
          );
        })}
        {alerts.data && !alerts.data.length && <div className="card"><EmptyState icon={<Check size={22} />} title={t("All clear")} hint={t("No open alerts")} /></div>}
      </div>
    </Page>
  );
}
