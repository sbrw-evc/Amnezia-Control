import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileClock, Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useLive } from "@/lib/live";
import { Badge, Card, Page, PageHeader, type Tone } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Controls";
import { k, t } from "@/i18n";

const ACTIONS: Record<string, [string, Tone]> = {
  "auth.login": [k("Sign-in"), "green"], "auth.login_failed": [k("Failed sign-in"), "red"], "auth.password_changed": [k("Password changed"), "blue"],
  "auth.2fa_enabled": [k("2FA enabled"), "green"], "auth.2fa_disabled": [k("2FA disabled"), "amber"],
  "client.created": [k("Client created"), "green"], "client.updated": [k("Client updated"), "blue"], "client.deleted": [k("Client deleted"), "red"],
  "client.blocked": [k("Block"), "amber"], "client.unblocked": [k("Unblock"), "green"], "client.reissued": [k("Keys reissued"), "violet"],
  "client.config_viewed": [k("Config issued"), "slate"], "client.share_link_created": [k("Link created"), "violet"], "client.share_link_used": [k("Link opened"), "violet"],
  "client.sync": [k("Sync"), "slate"], "server.config_saved": [k("Server config"), "red"], "routing.site_list_applied": [k("Site list"), "blue"],
  "settings.updated": [k("Settings"), "blue"], "panel_user.created": [k("Operator added"), "green"], "panel_user.updated": [k("Operator updated"), "blue"],
  "panel_user.deleted": [k("Operator deleted"), "red"], "panel_user.password_reset": [k("Password reset"), "amber"],
  "auth.logout": [k("Sign-out"), "slate"], "panel_user.bound": [k("Bound to SPA"), "violet"],
  "panel_user.disabled": [k("Disabled by SPA"), "red"], "spa.sync": [k("SPA synchronization"), "slate"],
};
const PAGE = 50;

export default function Audit() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useQuery({ queryKey: ["audit", q, action, offset], queryFn: () => api.ops.audit({ q, action, offset, limit: PAGE }), placeholderData: keepPreviousData });
  useLive("audit", () => data.refetch(), []);

  return (
    <Page>
      <PageHeader title={t("Audit log")} icon={<FileClock size={20} />} subtitle={t("Who changed what and when")} />
      <div className="card flex flex-wrap gap-2 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder={t("Search by object or action")} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <div className="w-[220px]">
          <Select value={action} onChange={(v) => { setAction(v); setOffset(0); }} options={[
            { value: "", label: t("All actions") }, { value: "client.", label: t("Clients") }, { value: "auth.", label: t("Authentication") },
            { value: "panel_user.", label: t("Operators") }, { value: "api_token.", label: t("API tokens") }, { value: "server.", label: t("Server") },
            { value: "routing.", label: t("Routing") }, { value: "flows.", label: t("Flows") }, { value: "backup.", label: t("Backups") },
            { value: "settings.", label: t("Settings") }, { value: "notifications.", label: t("Notifications") }]} />
        </div>
      </div>
      <Card bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>{t("Time")}</th><th>{t("Who")}</th><th>{t("Action")}</th><th>{t("Object")}</th><th>{t("Details")}</th><th>IP</th></tr></thead>
          <tbody>
            {data.isLoading && <tr><td colSpan={6}><Skeleton className="h-40" /></td></tr>}
            {data.data?.items.map((e) => {
              const [label, tone] = ACTIONS[e.action] ?? [e.action, "slate" as Tone];
              return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-slate-400">{Fmt.dateTime(e.ts)}</td>
                  <td className="text-slate-200">{e.actor}</td>
                  <td><Badge tone={tone}>{ACTIONS[e.action] ? t(label) : label}</Badge></td>
                  <td className="text-slate-300">{e.target_name || "—"}</td>
                  <td className="mono max-w-[360px] truncate text-slate-500" title={JSON.stringify(e.details)}>
                    {Object.entries(e.details).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}
                  </td>
                  <td className="mono text-slate-500">{e.ip}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-base-700/60 px-4 py-2 text-xs text-slate-400">
          <span>{t("Total: {n}", { n: data.data?.total ?? 0 })}</span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← {t("Back")}</button>
            <button className="btn-ghost btn-sm" disabled={!data.data || offset + PAGE >= data.data.total} onClick={() => setOffset(offset + PAGE)}>{t("Next")} →</button>
          </div>
        </div>
      </Card>
    </Page>
  );
}
