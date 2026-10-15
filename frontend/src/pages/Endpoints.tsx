import { useQuery } from "@tanstack/react-query";
import { MonitorSmartphone, Save, Search, Trash2, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import type { NetworkEndpoint } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Card, Field, Kpi, Modal, Page, PageHeader, Segmented } from "@/components/ui/Primitives";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import { EndpointTable } from "./DeviceDetail";

export default function Endpoints() {
  const canEdit = useAuth((s) => s.can("operator"));
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"online" | "all" | "wifi" | "blocked">("online");
  const [edit, setEdit] = useState<NetworkEndpoint | null>(null);
  const [alias, setAlias] = useState("");
  const [note, setNote] = useState("");
  const list = useQuery({ queryKey: ["endpoints"], queryFn: () => api.devices.endpoints(), refetchInterval: 30_000 });
  useLive("devices", () => list.refetch(), []);
  const save = useAction(() => api.devices.updateEndpoint(edit!.mac, { alias, note }), { success: t("Saved"), invalidate: [["endpoints"]], onSuccess: () => setEdit(null) });
  const forget = useAction((mac: string) => api.devices.forgetEndpoint(mac), { success: t("Client removed from the list"), invalidate: [["endpoints"]], onSuccess: () => setEdit(null) });

  const all = list.data ?? [];
  const rows = useMemo(() => all.filter((e) => (mode === "all" || (mode === "online" && e.online) || (mode === "wifi" && !!e.ssid) || (mode === "blocked" && e.blocked))
    && (!q || [e.name, e.ip, e.mac, e.vendor, e.device_name, e.ssid, e.hostname].join(" ").toLowerCase().includes(q.toLowerCase()))), [all, mode, q]);
  const vendors = useMemo(() => {
    const m = new Map<string, number>();
    const unknown = t("unknown");
    all.filter((e) => e.online).forEach((e) => m.set(e.vendor || unknown, (m.get(e.vendor || unknown) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [all]);

  return (
    <Page>
      <PageHeader title={t("Network clients")} icon={<MonitorSmartphone size={20} />}
        subtitle={t("All user devices: phones, laptops, TVs, cameras, servers — from ARP, DHCP, Wi-Fi and switch tables")} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label={t("Online")} value={all.filter((e) => e.online).length} icon={<MonitorSmartphone size={16} />} tone="green" />
        <Kpi label={t("Over Wi-Fi")} value={all.filter((e) => e.online && e.ssid).length} icon={<Wifi size={16} />} tone="violet" delay={0.05} />
        <Kpi label={t("Known in total")} value={all.length} icon={<MonitorSmartphone size={16} />} delay={0.1} />
        <div className="card p-[18px] text-xs text-slate-400">
          <div className="mb-2 text-[13px] font-semibold">{t("Vendors online")}</div>
          {vendors.map(([v, n]) => <div key={v} className="flex justify-between"><span className="truncate">{v}</span><span className="mono">{n}</span></div>)}
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder={t("Name, IP, MAC, vendor, SSID…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented layoutId="ep-mode" value={mode} onChange={setMode} options={[{ value: "online", label: t("Online") }, { value: "all", label: t("All") },
          { value: "wifi", label: "Wi-Fi" }, { value: "blocked", label: t("Blocked only") }]} />
      </div>
      {list.error && <ErrorState error={list.error} />}
      <Card bodyClass="p-0">
        {list.isLoading ? <Skeleton className="h-60" /> : <EndpointTable rows={rows} showDevice canBlock={canEdit}
          onEdit={canEdit ? (e) => { setEdit(e); setAlias(e.alias); setNote(e.note); } : undefined} />}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.name || edit.mac}` : ""}>
        <div className="space-y-3">
          <Field label={t("Display name")} hint={t("shown on the map and in flow analysis (the LocalHost dimension)")}><input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={edit?.hostname} /></Field>
          <Field label={t("Note")}><textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="mt-5 flex justify-between">
          <button className="btn-danger" onClick={async () => { if (edit && await confirm({ title: t("Forget the client?"), message: t("The record and the connection history will be deleted; the client comes back the next time it appears on the network."), danger: true, confirmLabel: t("Delete") })) forget.mutate(edit.mac); }}><Trash2 size={14} /></button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}><Save size={14} /> {t("Save")}</button>
        </div>
      </Modal>
    </Page>
  );
}
