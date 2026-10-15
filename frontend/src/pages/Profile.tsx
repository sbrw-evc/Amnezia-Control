import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LogOut, Monitor, ShieldCheck, UserCircle } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Fmt, ROLE_LABEL } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Badge, Card, Page, PageHeader } from "@/components/ui/Primitives";
import { t } from "@/i18n";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-base-700/60 py-2 last:border-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-slate-200">{children}</dd>
    </div>
  );
}

export default function Profile() {
  const user = useAuth((s) => s.user);
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.auth.sessions() });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api.auth.config() });
  const revoke = useAction((id: string) => api.auth.revokeSession(id), { invalidate: [["sessions"]] });
  const account = config.data?.account_url;

  return (
    <Page>
      <PageHeader title={t("Profile")} icon={<UserCircle size={20} />}
        subtitle={<>{user?.display_name || user?.username} · {t(ROLE_LABEL[user?.role ?? "viewer"])}</>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><UserCircle size={14} /> {t("Account")}</span>}>
          <dl>
            <Row label={t("Username")}><span className="mono">{user?.username}</span></Row>
            <Row label={t("Name")}>{user?.display_name || "—"}</Row>
            <Row label={t("E-mail")}>{user?.email || "—"}</Row>
            <Row label={t("Role")}>{t(ROLE_LABEL[user?.role ?? "viewer"])}</Row>
            <Row label={t("Groups")}>{user?.groups.length ? user.groups.join(", ") : "—"}</Row>
            <Row label={t("Last sign-in")}>{Fmt.dateTime(user?.last_login_at)}</Row>
          </dl>
        </Card>

        <Card title={<span className="flex items-center gap-2"><ShieldCheck size={14} /> {t("Account and security")}</span>}>
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              {t("Your account, password, passkeys and two-factor authentication are managed in SPA — Single Point of Authorization. Your role in Network Control is given there by an SPA administrator.")}
            </p>
            {account ? (
              <a className="btn-primary" href={account} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {t("Open account and security in SPA")}</a>
            ) : (
              <p className="text-xs text-slate-500">{t("The address of the SPA account page is not known yet.")}</p>
            )}
          </div>
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><Monitor size={14} /> {t("Active sessions")}</span>} bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>{t("Device")}</th><th>IP</th><th>{t("Created")}</th><th>{t("Activity")}</th><th /></tr></thead>
          <tbody>
            {sessions.data?.map((s) => (
              <tr key={s.id}>
                <td className="max-w-[360px] truncate text-slate-300" title={s.user_agent}>{s.user_agent || "—"} {s.current && <Badge tone="blue">{t("current")}</Badge>}</td>
                <td className="mono text-slate-400">{s.ip}</td>
                <td className="text-xs text-slate-400">{Fmt.dateTime(s.created_at)}</td>
                <td className="text-xs text-slate-400">{Fmt.ago(s.last_seen_at)}</td>
                <td>{!s.current && <button className="btn-ghost btn-sm" onClick={() => revoke.mutate(s.id)}><LogOut size={12} /> {t("End")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
