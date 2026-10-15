import { useQuery } from "@tanstack/react-query";
import { Bell, Save, Send, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Settings } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Page, PageHeader } from "@/components/ui/Primitives";
import { SetupGuide } from "@/components/onboarding/Steps";
import PasswordInput from "@/components/ui/PasswordInput";
import { Checkbox, NumberInput, Select } from "@/components/ui/Controls";
import { Skeleton } from "@/components/ui/Feedback";
import SpaConnection from "@/components/admin/SpaConnection";
import { k, t } from "@/i18n";

type Def = { key: string; label: string; hint?: string; type: "text" | "number" | "bool" | "select"; options?: [string, string][] };
const GROUPS: { title: string; anchor?: string; fields: Def[] }[] = [
  { title: k("Client configs"), fields: [
    { key: "client_dns", label: k("DNS for clients"), hint: k("comma-separated"), type: "text" },
    { key: "endpoint_host", label: k("Server address in configs"), hint: k("empty — AWG_HOST"), type: "text" },
    { key: "share_link_hours", label: k("Config link lifetime, h"), type: "number" },
  ] },
  { title: k("Default policies"), fields: [
    { key: "default_quota_gb", label: k("Default quota, GB/month"), hint: k("empty — unlimited"), type: "number" },
    { key: "default_valid_days", label: k("Default access period, days"), hint: k("empty — no limit"), type: "number" },
    { key: "quota_warn_percent", label: k("Warn when the quota is used, %"), type: "number" },
    { key: "expiry_warn_days", label: k("Warn before access ends, days"), type: "number" },
  ] },
  { title: k("Monitoring"), fields: [
    { key: "poll_seconds", label: k("Server polling interval, s"), type: "number" },
    { key: "retention_days", label: k("Keep statistics, days"), type: "number" },
    { key: "gateway_stale_minutes", label: k("Alert when the gateway is silent longer than, min"), type: "number" },
    { key: "timezone", label: k("Time zone of reports"), type: "text" },
  ] },
  { title: k("Notifications"), anchor: "notifications", fields: [
    { key: "notify_enabled", label: k("Send notifications"), type: "bool" },
    { key: "notify_min_severity", label: k("Minimum severity"), type: "select",
      options: [["info", k("Info")], ["warning", k("Warning")], ["critical", k("Critical")]] },
    { key: "notify_telegram_chat_id", label: k("Telegram chat id"), hint: k("ID of a user, group or channel"), type: "text" },
  ] },
  { title: k("Network and devices"), fields: [
    { key: "endpoint_offline_minutes", label: k("A client is offline after, min"), type: "number" },
    { key: "endpoint_retention_days", label: k("Forget inactive clients after, days"), type: "number" },
    { key: "flow_collector_host", label: k("Collector address for flow export"), hint: k("empty — GATEWAY_IP"), type: "text" },
    { key: "flow_collector_port", label: k("NetFlow / IPFIX port"), type: "number" },
  ] },
  { title: k("Traffic analysis"), fields: [
    { key: "threat_enabled", label: k("Check addresses against threat lists"), type: "bool" },
    { key: "threat_refresh_hours", label: k("Refresh threat lists every, h"), type: "number" },
    { key: "threat_exclude", label: k("Do not flag networks"), hint: k("your public addresses, space-separated"), type: "text" },
    { key: "rdns_enabled", label: k("Resolve names of remote hosts (PTR)"), type: "bool" },
  ] },
  { title: k("Backup"), fields: [
    { key: "backup_enabled", label: k("Daily backup"), type: "bool" },
    { key: "backup_keep", label: k("Backups to keep"), type: "number" },
  ] },
];

function TelegramCard({ isAdmin }: { isAdmin: boolean }) {
  const status = useQuery({ queryKey: ["notifications"], queryFn: () => api.admin.notifications() });
  const [token, setToken] = useState("");
  const save = useAction((t: string) => api.admin.setTelegramToken(t), { success: (r) => t("Bot @{bot} connected", { bot: r.bot }), invalidate: [["notifications"]], onSuccess: () => setToken("") });
  const test = useAction(() => api.admin.testNotification(), { success: t("Test message sent") });
  return (
    <Card title={<span className="flex items-center gap-2"><Bell size={14} /> {t("Telegram bot")}</span>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          {status.data?.configured ? <Badge tone="green">{t("configured")}{status.data.bot ? ` · @${status.data.bot}` : ""}</Badge>
            : status.data?.bot ? <Badge tone="amber">@{status.data.bot} · {t("enter the chat id")}</Badge> : <Badge>{t("not configured")}</Badge>}
        </div>
        <p className="text-xs text-slate-500">{t("Create a bot with @BotFather and paste its token. It is kept in OpenBao and not shown again.")}</p>
        {isAdmin && <>
          <div className="flex gap-2">
            <PasswordInput className="mono" placeholder="123456:ABC-DEF…" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn-ghost" disabled={!token || save.isPending} onClick={() => save.mutate(token)}><Save size={14} /></button>
          </div>
          <button className="btn-ghost btn-sm" disabled={!status.data?.configured || test.isPending} onClick={() => test.mutate(undefined)}><Send size={12} /> {t("Test message")}</button>
        </>}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.ops.settings(), refetchInterval: false, refetchOnWindowFocus: false });
  const [form, setForm] = useState<Settings>({});
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useAction((s: Settings) => api.ops.saveSettings(s), { success: t("Settings saved"), invalidate: [["settings"]] });
  const spaSync = useAction(() => api.users.sync(), { success: t("Synchronization done"), invalidate: [["spa"], ["users"]] });
  const { hash } = useLocation();
  // Steps of the checklist and of the guide link to a card of this page (#spa, #notifications).
  useEffect(() => {
    if (q.data && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [q.data, hash]);

  const set = (d: Def, v: string | boolean) =>
    setForm({ ...form, [d.key]: d.type === "number" ? (v === "" ? null : Number(v)) : v });

  const input = (d: Def) => {
    if (d.type === "bool") return <Checkbox disabled={!isAdmin} checked={!!form[d.key]} onChange={(v) => set(d, v)} label={t(d.label)} />;
    const control = d.type === "select"
      ? <Select disabled={!isAdmin} value={String(form[d.key] ?? "")} onChange={(v) => set(d, v)}
          options={(d.options ?? []).map(([v, l]) => ({ value: v, label: t(l) }))} />
      : d.type === "number"
        ? <NumberInput disabled={!isAdmin} allowEmpty placeholder="—" value={form[d.key] === null || form[d.key] === "" ? null : Number(form[d.key])}
            min={0} onChange={(v) => setForm({ ...form, [d.key]: v })} />
        : <input className="input" disabled={!isAdmin} value={String(form[d.key] ?? "")} onChange={(e) => set(d, e.target.value)} />;
    return <Field label={t(d.label)} hint={d.hint ? t(d.hint) : undefined}>{control}</Field>;
  };

  return (
    <Page>
      <PageHeader title={t("Settings")} icon={<SettingsIcon size={20} />} subtitle={isAdmin ? t("Panel parameters and business rules") : t("View only")}
        actions={isAdmin && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(form)}><Save size={16} /> {t("Save")}</button>} />
      <SetupGuide page="settings" actions={{ sync: () => spaSync.mutate(undefined) }} />
      {!q.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4 xl:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title} id={g.anchor} className="scroll-mt-20">
              <Card title={t(g.title)}>
                <div className="space-y-4">{g.fields.map((d) => <div key={d.key}>{input(d)}</div>)}</div>
              </Card>
            </div>
          ))}
          <TelegramCard isAdmin={isAdmin} />
          {isAdmin && <div id="spa" className="scroll-mt-20 xl:col-span-2"><SpaConnection /></div>}
        </div>
      )}
    </Page>
  );
}
