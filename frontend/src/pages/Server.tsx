import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, Save, Server as ServerIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Badge, Card, Page, PageHeader } from "@/components/ui/Primitives";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";

function lineDiff(a: string, b: string) {
  const A = new Set(a.split("\n")), B = new Set(b.split("\n"));
  return { added: [...B].filter((l) => !A.has(l)).length, removed: [...A].filter((l) => !B.has(l)).length };
}

export default function Server() {
  const info = useQuery({ queryKey: ["server-info"], queryFn: () => api.ops.serverInfo() });

  const cfg = useQuery({ queryKey: ["server-config"], queryFn: () => api.ops.serverConfig(), refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [text, setText] = useState("");
  const [source, setSource] = useState("текущий");
  useEffect(() => { if (cfg.data) { setText(cfg.data.config); setSource("текущий"); } }, [cfg.data]);
  const diff = useMemo(() => (cfg.data ? lineDiff(cfg.data.config, text) : { added: 0, removed: 0 }), [cfg.data, text]);
  const save = useAction((t: string) => api.ops.saveServerConfig(t), { success: "Конфиг применён без разрыва соединений", invalidate: [["server-config"], ["server-info"], ["clients"]] });
  const loadBackup = useAction((name: string) => api.ops.backup(name), { onSuccess: (r) => setText(r.config) });

  const i = info.data;
  return (
    <Page>
      <PageHeader title="Сервер AmneziaWG" icon={<ServerIcon size={20} />} subtitle={i ? `${i.versions.tools} · ${i.versions.go}` : "…"} />
      {info.error && <ErrorState error={info.error} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Интерфейс">
          {i ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Порт</span><span className="mono">{i.port}/udp</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Сеть</span><span className="mono">{i.network}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Пиров</span><span>{i.peers_total} <span className="text-slate-500">({i.peers_disabled} заблок.)</span></span></div>
              <div className="pt-2 text-slate-500">Публичный ключ</div>
              <div className="mono break-all text-[11px] text-slate-300">{i.public_key}</div>
            </div>
          ) : <Skeleton className="h-40" />}
        </Card>
        <Card className="xl:col-span-2" title="Параметры обфускации (передаются клиентам)">
          {i ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(i.params).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-base-700 bg-base-950/50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                  <div className="mono truncate text-slate-200" title={v}>{v}</div>
                </div>
              ))}
            </div>
          ) : <Skeleton className="h-40" />}
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2">awg0.conf <Badge>{source}</Badge>{(diff.added || diff.removed) ? <Badge tone="amber">+{diff.added} / −{diff.removed} строк</Badge> : null}</span>}
        actions={<>
          <History size={14} className="text-slate-500" />
          <select className="input !w-auto !py-1.5 text-xs" value="" onChange={(e) => { if (e.target.value) { loadBackup.mutate(e.target.value); setSource(e.target.value); } }}>
            <option value="">Резервные копии ({cfg.data?.backups.length ?? 0})</option>
            {cfg.data?.backups.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button className="btn-ghost btn-sm" onClick={() => cfg.refetch()}><RotateCcw size={14} /> Сбросить</button>
          <button className="btn-primary btn-sm" disabled={save.isPending || (!diff.added && !diff.removed)} onClick={async () => {
            if (await confirm({ title: "Применить конфиг на сервере?", message: "Перед записью будет создана резервная копия. Изменения применятся через syncconf без разрыва остальных соединений.", confirmLabel: "Применить" }))
              save.mutate(text);
          }}><Save size={14} /> Сохранить и применить</button>
        </>}>
        {cfg.data ? (
          <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            className="mono h-[520px] w-full resize-y rounded-lg border border-base-700 bg-base-950 p-3 leading-relaxed text-slate-300 outline-none focus:border-accent" />
        ) : <Skeleton className="h-[520px]" />}
        <p className="mt-2 text-xs text-slate-500">Заблокированные пиры закомментированы префиксом <code className="mono">#DISABLED#</code>. Хранится 50 последних копий в <code className="mono">/opt/amnezia/awg/backups</code>.</p>
      </Card>
    </Page>
  );
}
