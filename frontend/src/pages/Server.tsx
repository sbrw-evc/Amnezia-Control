import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, Save, Server as ServerIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { t } from "@/i18n";
import { Badge, Card, Page, PageHeader } from "@/components/ui/Primitives";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import { Select } from "@/components/ui/Controls";

/** A translated text with React nodes in place of its {placeholders}. */
const rich = (s: string, parts: Record<string, ReactNode>) =>
  s.split(/(\{\w+\})/).map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : p}</Fragment>;
  });

function lineDiff(a: string, b: string) {
  const A = new Set(a.split("\n")), B = new Set(b.split("\n"));
  return { added: [...B].filter((l) => !A.has(l)).length, removed: [...A].filter((l) => !B.has(l)).length };
}

export default function Server() {
  const info = useQuery({ queryKey: ["server-info"], queryFn: () => api.ops.serverInfo() });

  const cfg = useQuery({ queryKey: ["server-config"], queryFn: () => api.ops.serverConfig(), refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [text, setText] = useState("");
  // The backup shown in the editor; empty means the current config.
  const [source, setSource] = useState("");
  useEffect(() => { if (cfg.data) { setText(cfg.data.config); setSource(""); } }, [cfg.data]);
  const diff = useMemo(() => (cfg.data ? lineDiff(cfg.data.config, text) : { added: 0, removed: 0 }), [cfg.data, text]);
  const save = useAction((conf: string) => api.ops.saveServerConfig(conf), { success: t("Config applied without dropping connections"), invalidate: [["server-config"], ["server-info"], ["clients"]] });
  const loadBackup = useAction((name: string) => api.ops.backup(name), { onSuccess: (r) => setText(r.config) });

  const i = info.data;
  return (
    <Page>
      <PageHeader title={t("AmneziaWG server")} icon={<ServerIcon size={20} />} subtitle={i ? `${i.versions.tools} · ${i.versions.go}` : "…"} />
      {info.error && <ErrorState error={info.error} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t("Interface")}>
          {i ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t("Port")}</span><span className="mono">{i.port}/udp</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t("Network")}</span><span className="mono">{i.network}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t("Peers")}</span><span>{i.peers_total} <span className="text-slate-500">{t("({n} blocked)", { n: i.peers_disabled })}</span></span></div>
              <div className="pt-2 text-slate-500">{t("Public key")}</div>
              <div className="mono break-all text-[11px] text-slate-300">{i.public_key}</div>
            </div>
          ) : <Skeleton className="h-40" />}
        </Card>
        <Card className="xl:col-span-2" title={t("Obfuscation parameters (passed to clients)")}>
          {i ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(i.params).map(([key, v]) => (
                <div key={key} className="rounded-lg border border-base-700 bg-base-950/50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">{key}</div>
                  <div className="mono truncate text-slate-200" title={v}>{v}</div>
                </div>
              ))}
            </div>
          ) : <Skeleton className="h-40" />}
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2">awg0.conf <Badge>{source || t("current")}</Badge>{(diff.added || diff.removed) ? <Badge tone="amber">{t("+{added} / −{removed} lines", { added: diff.added, removed: diff.removed })}</Badge> : null}</span>}
        actions={<>
          <History size={14} className="text-slate-500" />
          <div className="w-[240px]">
            <Select size="sm" value={null} placeholder={t("Backups ({n})", { n: cfg.data?.backups.length ?? 0 })} menuWidth={280}
              onChange={(b: string) => { loadBackup.mutate(b); setSource(b); }}
              options={(cfg.data?.backups ?? []).map((b) => ({ value: b, label: b }))} />
          </div>
          <button className="btn-ghost btn-sm" onClick={() => cfg.refetch()}><RotateCcw size={14} /> {t("Reset")}</button>
          <button className="btn-primary btn-sm" disabled={save.isPending || (!diff.added && !diff.removed)} onClick={async () => {
            if (await confirm({ title: t("Apply the config on the server?"), confirmLabel: t("Apply"),
              message: t("A backup is made before writing. The changes are applied with syncconf without dropping other connections.") }))
              save.mutate(text);
          }}><Save size={14} /> {t("Save and apply")}</button>
        </>}>
        {cfg.data ? (
          <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            className="mono h-[520px] w-full resize-y rounded-lg border border-base-700 bg-base-950 p-3 leading-relaxed text-slate-300 outline-none focus:border-accent" />
        ) : <Skeleton className="h-[520px]" />}
        <p className="mt-2 text-xs text-slate-500">{rich(t("Blocked peers are commented out with the prefix {prefix}. The last 50 copies are kept in {dir}."), {
          prefix: <code className="mono">#DISABLED#</code>, dir: <code className="mono">/opt/amnezia/awg/backups</code> })}</p>
      </Card>
    </Page>
  );
}
