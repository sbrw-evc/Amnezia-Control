import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Ban, CheckCircle2, Download, Lock, Plus, QrCode, RefreshCw, Search, ShieldOff, Trash2, Unlock, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Fmt, REASON_LABEL } from "@/lib/format";
import Flag from "@/components/ui/Flag";
import { useAction } from "@/lib/hooks";
import { SERVER_LABEL, type ServerKind, type VpnClient } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Modal, Page, PageHeader, StatusDot, UsageBar } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import { Checkbox } from "@/components/ui/Controls";
import ClientForm from "@/components/clients/ClientForm";
import ConfigModal from "@/components/clients/ConfigModal";
import { useClientActions } from "@/components/clients/useClientActions";

type Filter = "all" | "online" | "active" | "blocked" | "missing" | "unmanaged";
const FILTERS: { value: Filter; label: string; test: (c: VpnClient) => boolean }[] = [
  { value: "all", label: "Все", test: () => true },
  { value: "online", label: "Онлайн", test: (c) => c.online },
  { value: "active", label: "Активные", test: (c) => c.status === "active" },
  { value: "blocked", label: "Заблокированы", test: (c) => c.status === "blocked" },
  { value: "missing", label: "Удалены на сервере", test: (c) => c.status === "missing" },
  { value: "unmanaged", label: "Без ключа в панели", test: (c) => !c.managed },
];
type SortKey = "name" | "month" | "total" | "handshake" | "rate";

function exportCsv(clients: VpnClient[]) {
  const head = ["Сервер", "Имя", "Владелец", "Контакт", "Теги", "Адрес", "Статус", "Онлайн", "Месяц, байт", "Всего, байт", "Квота, байт",
    "Доступ до", "Страна", "Город", "Последний handshake", "Создан"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = clients.map((c) => [SERVER_LABEL[c.server], c.name, c.owner, c.contact, c.tags.join(" "), c.address, c.status, c.online ? "да" : "нет",
    c.month_rx + c.month_tx, c.total_rx + c.total_tx, c.quota_bytes ?? "", c.expires_at ?? "", c.country ?? "", c.city ?? "",
    c.last_handshake_at ?? "", c.created_at ?? ""].map(esc).join(";"));
  const blob = new Blob(["﻿" + [head.map(esc).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `amnezia-clients-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Clients() {
  const nav = useNavigate();
  const canEdit = useAuth((s) => s.can("operator"));
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [server, setServer] = useState<ServerKind | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rate", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [tbody] = useAutoAnimate<HTMLTableSectionElement>();

  const list = useQuery({ queryKey: ["clients"], queryFn: () => api.clients.list(), refetchInterval: 15_000 });
  const tags = useQuery({ queryKey: ["clients", "tags"], queryFn: () => api.clients.tags() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.ops.settings(), enabled: creating });
  const servers = useQuery({ queryKey: ["vpn-servers"], queryFn: () => api.clients.servers(), staleTime: 30_000 });
  const actions = useClientActions();
  const create = useAction(api.clients.create.bind(api.clients), {
    success: "Клиент создан", invalidate: [["clients"], ["summary"]],
    onSuccess: (c) => { setCreating(false); setConfigFor(c.id); },
  });
  const sync = useAction(() => api.clients.sync(), {
    success: (r) => `Синхронизировано: пиров ${r.peers}, импортировано ${r.imported}, пропало ${r.missing}`, invalidate: [["clients"]],
  });
  const bulk = useAction(({ ids, action }: { ids: string[]; action: "block" | "unblock" | "delete" }) => api.clients.bulk(ids, action), {
    success: (r) => `Готово: ${r.done}${r.failed.length ? `, ошибок: ${r.failed.length}` : ""}`, invalidate: [["clients"], ["summary"]],
    onSuccess: () => setSelected(new Set()),
  });

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter)!.test;
    const s = q.trim().toLowerCase();
    const val = (c: VpnClient): number | string => ({
      name: c.name.toLowerCase(), month: c.month_rx + c.month_tx, total: c.total_rx + c.total_tx,
      handshake: c.last_handshake_at ? Date.parse(c.last_handshake_at) : 0, rate: c.rate_rx + c.rate_tx + (c.online ? 1e-9 : 0),
    })[sort.key];
    return (list.data ?? [])
      .filter((c) => f(c) && (!tag || c.tags.includes(tag)) && (!server || c.server === server))
      .filter((c) => !s || [c.name, c.owner, c.address, c.city ?? "", c.public_key].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [list.data, filter, tag, server, q, sort]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, (list.data ?? []).filter(f.test).length])), [list.data]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectable = rows.filter((r) => !r.system);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none hover:text-slate-300" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}>
      {label} {sort.key === key && (sort.dir === 1 ? "▲" : "▼")}
    </th>
  );

  return (
    <Page>
      <PageHeader title="Клиенты VPN" icon={<Users size={20} />} subtitle={`${counts.all ?? 0} клиентов · ${counts.online ?? 0} онлайн`}
        actions={<>
          <button className="btn-ghost" onClick={() => exportCsv(rows)} disabled={!rows.length}><Download size={16} /> CSV</button>
          {canEdit && <>
          <button className="btn-ghost" onClick={() => sync.mutate(undefined)} disabled={sync.isPending}>
            <RefreshCw size={16} className={clsx(sync.isPending && "animate-spin")} /> Синхронизировать
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Новый клиент</button>
          </>}
        </>} />

      <div className="card space-y-3 p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Поиск по имени, владельцу, адресу, городу, ключу…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button key={f.value} className={clsx("chip", filter === f.value && "chip-on")} onClick={() => setFilter(f.value)}>
              {f.value === "online" && <StatusDot on pulse={false} />}{f.label}
              <span className="rounded bg-base-950/60 px-1 text-[10px] text-slate-400">{counts[f.value] ?? 0}</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-base-700" />
          {(servers.data ?? []).map((s) => (
            <button key={s.kind} className={clsx("chip", server === s.kind && "chip-on")} onClick={() => setServer(server === s.kind ? null : s.kind)}>
              {SERVER_LABEL[s.kind]}
              <span className="rounded bg-base-950/60 px-1 text-[10px] text-slate-400">{(list.data ?? []).filter((c) => c.server === s.kind).length}</span>
            </button>
          ))}
          {!!tags.data?.length && <span className="mx-1 h-5 w-px bg-base-700" />}
          {tags.data?.map((t) => (
            <button key={t} className={clsx("chip", tag === t && "chip-on")} onClick={() => setTag(tag === t ? null : t)}>#{t}</button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected.size > 0 && canEdit && (
          <motion.div initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -8, height: 0 }}
            className="card flex flex-wrap items-center gap-2 border-accent/40 p-3">
            <span className="text-sm text-slate-300">Выбрано: <b className="text-white">{selected.size}</b></span>
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => bulk.mutate({ ids: [...selected], action: "block" })}><Lock size={14} /> Заблокировать</button>
              <button className="btn-ghost btn-sm" onClick={() => bulk.mutate({ ids: [...selected], action: "unblock" })}><Unlock size={14} /> Разблокировать</button>
              <button className="btn-danger btn-sm" onClick={async () => {
                if (await confirm({ title: "Удалить клиентов?", message: `Будет удалено ${selected.size} клиентов вместе с ключами.`, danger: true, confirmLabel: "Удалить" }))
                  bulk.mutate({ ids: [...selected], action: "delete" });
              }}><Trash2 size={14} /> Удалить</button>
              <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Сбросить</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {list.error && <ErrorState error={list.error} />}
      <div className="card overflow-hidden">
        <div className="max-h-[calc(100vh-320px)] overflow-auto">
          <table className="table-ac min-w-[1100px]">
            <thead>
              <tr>
                {canEdit && <th className="w-8"><Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} title="Выбрать все"
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.filter((r) => !r.system).map((r) => r.id)))} /></th>}
                {th("name", "Клиент")}
                <th>Адрес</th>
                <th>Статус</th>
                {th("rate", "Скорость ↓/↑")}
                {th("month", "Месяц / квота")}
                {th("total", "Всего")}
                <th>Локация</th>
                {th("handshake", "Handshake")}
                <th>Доступ</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody ref={tbody}>
              {list.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={11}><Skeleton className="h-6" /></td></tr>)}
              {rows.map((c) => (
                <tr key={c.id} className={clsx("cursor-pointer", selected.has(c.id) && "bg-accent/5")} onClick={() => nav(`/clients/${c.id}`)}>
                  {canEdit && <td onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(c.id)} onChange={() => toggle(c.id)} disabled={c.system} /></td>}
                  <td>
                    <div className="flex items-center gap-2">
                      <StatusDot on={c.online} />
                      <span className="max-w-[260px] truncate font-medium text-slate-100" title={c.name}>{c.name}</span>
                      {c.server === "mikrotik" && <Badge tone="blue" className="!px-1">MikroTik</Badge>}
                      {c.system && <Badge tone="violet">шлюз</Badge>}
                      {!c.managed && <Badge tone="amber" className="!px-1">без ключа</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1 pl-[18px] text-xs text-slate-500">
                      {c.owner && <span>{c.owner}</span>}
                      {c.tags.map((t) => <span key={t} className="text-blue-300/70">#{t}</span>)}
                    </div>
                  </td>
                  <td className="mono text-slate-400">{c.address.replace("/32", "")}</td>
                  <td>
                    {c.status === "active" ? <Badge tone="green">активен</Badge>
                      : c.status === "blocked" ? <Badge tone="red"><Ban size={10} /> {REASON_LABEL[c.block_reason ?? "manual"]}</Badge>
                      : <Badge tone="amber">нет на сервере</Badge>}
                  </td>
                  <td className="mono whitespace-nowrap text-slate-300">{c.online || c.rate_rx ? <>{Fmt.rate(c.rate_rx)} <span className="text-slate-600">/</span> {Fmt.rate(c.rate_tx)}</> : <span className="text-slate-600">—</span>}</td>
                  <td className="w-44">
                    {c.quota_bytes ? <UsageBar percent={c.quota_percent} label={`${Fmt.bytes(c.quota_used_bytes, 0)} / ${Fmt.bytes(c.quota_bytes, 0)}`} />
                      : <span className="mono text-slate-300">{Fmt.bytes(c.month_rx + c.month_tx)}</span>}
                  </td>
                  <td className="mono whitespace-nowrap text-slate-400">{Fmt.bytes(c.total_rx + c.total_tx)}</td>
                  <td className="whitespace-nowrap text-slate-400">{c.country_code ? <><Flag code={c.country_code} /> {c.city || c.country}</> : "—"}</td>
                  <td className="whitespace-nowrap text-xs text-slate-400">{Fmt.ago(c.last_handshake_at)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {c.expires_at ? <span className={clsx(new Date(c.expires_at).getTime() - Date.now() < 3 * 86400000 ? "text-amber-300" : "text-slate-400")}>{Fmt.until(c.expires_at)}</span> : <span className="text-slate-600">∞</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <button className="rounded-md p-1.5 text-slate-400 hover:bg-base-700 hover:text-white disabled:opacity-30" title="Конфиг" disabled={!c.managed} onClick={() => setConfigFor(c.id)}><QrCode size={15} /></button>
                        {!c.system && c.status !== "missing" && (
                          <button className="rounded-md p-1.5 text-slate-400 hover:bg-base-700 hover:text-white" title={c.status === "blocked" ? "Разблокировать" : "Заблокировать"} onClick={() => actions.toggleBlock(c)}>
                            {c.status === "blocked" ? <CheckCircle2 size={15} /> : <ShieldOff size={15} />}
                          </button>
                        )}
                        {!c.system && <button className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" title="Удалить" onClick={() => actions.remove(c)}><Trash2 size={15} /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !rows.length && <EmptyState title="Клиенты не найдены" hint="Измените фильтры или создайте нового клиента" />}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый клиент VPN" wide>
        <ClientForm key={settings.dataUpdatedAt} servers={servers.data} submitLabel="Создать и выдать конфиг" busy={create.isPending} onSubmit={(d) => create.mutate(d)} initial={{
          quota_bytes: settings.data?.default_quota_gb ? Number(settings.data.default_quota_gb) * 1024 ** 3 : null,
          expires_at: settings.data?.default_valid_days ? new Date(Date.now() + Number(settings.data.default_valid_days) * 86400000).toISOString() : null,
        }} />
      </Modal>
      <ConfigModal clientId={configFor} onClose={() => setConfigFor(null)} />
    </Page>
  );
}
