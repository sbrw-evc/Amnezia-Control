import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Fingerprint, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { Badge, Card } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import { ConnectInstructions } from "@/pages/Login";
import { k, t, tServer } from "@/i18n";

const KEY_SOURCE: Record<string, string> = {
  env: k("SPA_CONNECTION_KEY"), file: k("SPA_CONNECTION_KEY_FILE"), openbao: k("OpenBao: spa/connection_key"),
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-base-700/60 py-2 last:border-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-200">{children}</dd>
    </div>
  );
}

/** The SPA connection on the settings and users pages: issuer, application, last synchronisation, Synchronize now. */
export default function SpaConnection() {
  const q = useQuery({ queryKey: ["spa"], queryFn: () => api.users.spa(), refetchInterval: 30_000 });
  const sync = useAction(() => api.users.sync(), {
    success: (r) => r.unchanged ? t("Nothing changed in SPA") : t("Synchronized: {created} created, {updated} updated, {disabled} disabled", {
      created: r.created ?? 0, updated: r.updated ?? 0, disabled: r.disabled ?? 0 }),
    invalidate: [["spa"], ["users"], ["tokens"]],
  });
  const s = q.data;

  return (
    <Card title={<span className="flex items-center gap-2"><Fingerprint size={14} /> {t("SPA — Single Point of Authorization")}</span>}
      actions={s?.connected && (
        <button className="btn-ghost btn-sm" disabled={sync.isPending} onClick={() => sync.mutate(undefined)}>
          <RefreshCw size={13} className={sync.isPending ? "animate-spin" : undefined} /> {t("Synchronize now")}
        </button>
      )}>
      {!s ? <Skeleton className="h-40" /> : !s.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-medium text-amber-300"><AlertTriangle size={16} /> {t("This application is not connected to SPA")}</div>
          <ConnectInstructions error={s.key_error} />
        </div>
      ) : (
        <div className="space-y-3">
          {s.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {tServer(s.error)}
            </div>
          )}
          <dl>
            <Row label={t("Issuer")}><a className="inline-flex items-center gap-1 text-accent hover:underline" href={s.issuer ?? "#"} target="_blank" rel="noreferrer"><span className="mono break-all">{s.issuer}</span> <ExternalLink size={12} /></a></Row>
            <Row label={t("Application")}>{s.application ?? "—"} <span className="mono text-xs text-slate-500">{s.client_id}</span></Row>
            <Row label={t("Connection key")}>{s.key_source ? t(KEY_SOURCE[s.key_source]) : "—"}</Row>
            <Row label={t("Last synchronization")}>
              {s.last_sync_at ? <span title={Fmt.dateTime(s.last_sync_at)}>{Fmt.ago(s.last_sync_at)}</span> : <Badge tone="amber">{t("not yet")}</Badge>}
              <div className="text-xs text-slate-500">{t("every {n} min", { n: Math.round(s.sync_seconds / 60) })}</div>
            </Row>
            <Row label={t("Users")}>
              {t("{active} active of {total}", { active: s.counts.active ?? 0, total: s.counts.users ?? 0 })}
            </Row>
            {s.last_result && !s.last_result.unchanged && (s.last_result.created || s.last_result.updated || s.last_result.disabled) ? (
              <Row label={t("Last changes")}>
                {t("{created} created, {updated} updated, {disabled} disabled", {
                  created: s.last_result.created ?? 0, updated: s.last_result.updated ?? 0, disabled: s.last_result.disabled ?? 0 })}
              </Row>
            ) : null}
            <Row label={t("Role catalogue")}>
              <div className="flex flex-wrap justify-end gap-1">{s.roles.map((r) => <Badge key={r.id} tone="slate">{r.id}</Badge>)}</div>
              <div className="text-xs text-slate-500">{s.roles_published_at ? t("published {when}", { when: Fmt.ago(s.roles_published_at) }) : t("not published yet")}</div>
            </Row>
          </dl>
        </div>
      )}
    </Card>
  );
}
