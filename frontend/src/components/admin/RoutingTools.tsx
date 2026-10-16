import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Globe2, Network, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { RouteCheck } from "@/lib/types";
import { Badge, Card } from "@/components/ui/Primitives";
import { confirm } from "@/components/ui/Confirm";

export function RouteChecker() {
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<RouteCheck | null>(null);
  const check = useAction((t: string) => api.admin.checkRoute(t), { onSuccess: setResult });
  return (
    <Card title="Куда пойдёт трафик">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (target) check.mutate(target); }}>
        <input className="input" placeholder="youtube.com или 142.250.74.46" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className="btn-primary" disabled={check.isPending}><Search size={14} /></button>
      </form>
      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2"><span className="text-slate-300">{result.target}</span>
            {result.via_vpn ? <Badge tone="violet">через VPN</Badge> : <Badge tone="slate">напрямую</Badge>}
            {result.rule && <Badge tone="blue">правило домена</Badge>}</div>
          {result.ips.map((i) => (
            <div key={i.ip} className="flex items-center justify-between text-xs">
              <span className="mono text-slate-400">{i.ip}</span>
              <span className={i.via_vpn ? "text-violet-300" : "text-slate-500"}>{i.via_vpn ? `VPN · ${i.prefix}` : "провайдер"}</span>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">Адреса получены DNS-запросом со шлюза; у CDN они могут отличаться от адресов на ваших устройствах.</p>
        </motion.div>
      )}
    </Card>
  );
}

export function CustomPrefixes({ isAdmin }: { isAdmin: boolean }) {
  const list = useQuery({ queryKey: ["custom-prefixes"], queryFn: () => api.admin.customPrefixes() });
  const [target, setTarget] = useState("");
  const [comment, setComment] = useState("");
  const add = useAction(() => api.admin.addCustomPrefix(target, comment), {
    success: "Адрес добавлен в маршрутизацию через VPN", invalidate: [["custom-prefixes"], ["routing"]],
    onSuccess: () => { setTarget(""); setComment(""); },
  });
  const remove = useAction((cidr: string) => api.admin.removeCustomPrefix(cidr), { success: "Адрес удалён", invalidate: [["custom-prefixes"], ["routing"]] });
  return (
    <Card title="Свои адреса через VPN" bodyClass="space-y-3 p-4">
      {isAdmin && (
        <form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
          <input className="input mono" placeholder="example.com или 203.0.113.0/24" value={target} onChange={(e) => setTarget(e.target.value)} />
          <input className="input" placeholder="Комментарий" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary" disabled={!target || add.isPending}><Plus size={14} /></button>
        </form>
      )}
      {isAdmin && <p className="text-[11px] text-slate-500">Домен резолвит роутер и сам обновляет его адреса; поддомены добавляются отдельно.</p>}
      <div className="space-y-1">
        {(list.data ?? []).map((c) => (
          <div key={c.cidr} className="flex items-center gap-2 rounded-md bg-base-950/50 px-2 py-1.5 text-sm">
            <span className="text-slate-500">{c.kind === "domain" ? <Globe2 size={13} /> : <Network size={13} />}</span>
            <span className="mono text-slate-200" title={c.ips?.join(", ")}>{c.cidr}</span>
            {c.kind === "domain" && !!c.ips?.length && <Badge tone="slate">{c.ips.length} IP</Badge>}
            <span className="flex-1 truncate text-slate-400">{c.comment}</span>
            <span className="text-[11px] text-slate-600">{c.added_by} · {Fmt.ago(c.added_at)}</span>
            {isAdmin && <button className="p-1 text-slate-500 hover:text-red-300" onClick={async () => {
              if (await confirm({ title: "Убрать из VPN?", message: c.cidr, danger: true, confirmLabel: "Убрать" })) remove.mutate(c.cidr);
            }}><Trash2 size={13} /></button>}
          </div>
        ))}
        {list.data && !list.data.length && <div className="py-3 text-center text-xs text-slate-500">Нет своих адресов — используется только список сайтов</div>}
      </div>
    </Card>
  );
}
