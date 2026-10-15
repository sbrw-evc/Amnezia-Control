import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, UserCog } from "lucide-react";
import { api } from "@/lib/api";
import { Fmt, ROLE_LABEL } from "@/lib/format";
import { useAuth } from "@/store/auth";
import { Badge, Card, Page, PageHeader } from "@/components/ui/Primitives";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import ApiTokens from "@/components/admin/ApiTokens";
import SpaConnection from "@/components/admin/SpaConnection";
import { t } from "@/i18n";

/** People who may use Network Control: read-only records synchronised from SPA, plus the API tokens. */
export default function Users() {
  const me = useAuth((s) => s.user);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.users.list() });
  const spa = useQuery({ queryKey: ["spa"], queryFn: () => api.users.spa() });
  const issuer = spa.data?.issuer;

  return (
    <Page>
      <PageHeader title={t("Users and access")} icon={<UserCog size={20} />}
        subtitle={t("People, their roles and sign-in are managed in SPA; Network Control synchronises them every 5 minutes.")}
        actions={issuer && (
          <a className="btn-ghost" href={issuer} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {t("Manage in SPA")}</a>
        )} />

      <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
        <Info size={18} className="mt-0.5 shrink-0" />
        <div>{t("Creating users, passwords, passkeys, roles and enabling or disabling people are managed in SPA. A person disabled in SPA loses their sessions and API tokens here at the next synchronization.")}</div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card bodyClass="p-0">
          <table className="table-nc">
            <thead><tr><th>{t("User")}</th><th>{t("Role")}</th><th>{t("Groups")}</th><th>{t("Status")}</th><th>{t("Last sign-in")}</th></tr></thead>
            <tbody>
              {users.isLoading && <tr><td colSpan={5}><Skeleton className="h-24" /></td></tr>}
              {users.data?.map((u) => (
                <tr key={u.id} className={u.is_active ? undefined : "opacity-60"}>
                  <td>
                    <div className="font-medium text-slate-100">{u.display_name || u.username} {u.id === me?.id && <Badge tone="blue">{t("you")}</Badge>}</div>
                    <div className="mono text-slate-500">{u.username}{u.email && <span className="text-slate-600"> · {u.email}</span>}</div>
                  </td>
                  <td><Badge tone={u.role === "admin" ? "red" : u.role === "operator" ? "amber" : "blue"}>{t(ROLE_LABEL[u.role])}</Badge></td>
                  <td className="text-xs text-slate-400">{u.groups.length ? u.groups.join(", ") : "—"}</td>
                  <td className="space-x-1">
                    {u.is_active ? <Badge tone="green">{t("active")}</Badge> : <Badge tone="red">{t("disabled")}</Badge>}
                    {!u.external_id && <Badge tone="amber">{t("not in SPA")}</Badge>}
                  </td>
                  <td className="text-xs text-slate-400">{Fmt.ago(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.data && !users.data.length && <EmptyState title={t("No users yet")} hint={t("They appear after the first synchronization with SPA")} />}
        </Card>
        <SpaConnection />
      </div>

      <ApiTokens />
    </Page>
  );
}
