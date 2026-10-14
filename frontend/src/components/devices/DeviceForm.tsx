import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, PlugZap, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type DeviceInput } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { CRED_LABEL, ROLE_LABEL, SECRET_FIELDS, SEGMENT_LABEL, TRANSPORT_LABEL } from "@/lib/network";
import type { DevicePlatform, NetworkDevice } from "@/lib/types";
import { Badge, Field, Modal, Segmented } from "@/components/ui/Primitives";
import { Checkbox, NumberInput, Select } from "@/components/ui/Controls";
import PasswordInput from "@/components/ui/PasswordInput";

export interface DevicePrefill { host?: string; platform?: string; name?: string }

type Form = {
  name: string; platform: string; host: string; port: number | null; transport: string; verify_tls: boolean; site: string;
  location: string; role: string; tags: string; note: string; enabled: boolean; poll_seconds: number; flow_exporter_ip: string;
  use_system_key: boolean; credentials: Record<string, string>;
};

const EMPTY: Form = {
  name: "", platform: "mikrotik", host: "", port: null, transport: "", verify_tls: false, site: "", location: "", role: "",
  tags: "", note: "", enabled: true, poll_seconds: 300, flow_exporter_ip: "", use_system_key: false, credentials: {},
};

function credFields(p: DevicePlatform | undefined, transport: string): string[] {
  if (!p) return [];
  const snmp = transport === "snmp";
  return p.credentials.filter((c) => (snmp ? c.startsWith("snmp_") : !c.startsWith("snmp_")) && !(transport !== "ssh" && c === "private_key")
    && !(transport !== "ssh" && c === "enable_password"));
}

export default function DeviceForm({ open, onClose, device, prefill }: { open: boolean; onClose: () => void; device?: NetworkDevice; prefill?: DevicePrefill }) {
  const platforms = useQuery({ queryKey: ["device-platforms"], queryFn: () => api.devices.platforms(), staleTime: Infinity });
  const [f, setF] = useState<Form>(EMPTY);
  const [tested, setTested] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => { setF((x) => ({ ...x, ...patch })); setTested(null); };
  const setCred = (k: string, v: string) => set({ credentials: { ...f.credentials, [k]: v } });

  useEffect(() => {
    if (!open) return;
    setTested(null);
    if (device) {
      const creds: Record<string, string> = {};
      for (const [k, v] of Object.entries(device.credentials ?? {})) if (typeof v === "string") creds[k] = v;
      setF({ name: device.name, platform: device.platform, host: device.host, port: device.port, transport: device.transport,
        verify_tls: device.verify_tls, site: device.site, location: device.location, role: device.role, tags: device.tags.join(", "),
        note: device.note, enabled: device.enabled, poll_seconds: device.poll_seconds, flow_exporter_ip: device.flow_exporter_ip,
        use_system_key: device.use_system_key, credentials: creds });
    } else setF({ ...EMPTY, ...prefill, name: prefill?.name ?? "" });
  }, [open, device, prefill]);

  const p = platforms.data?.find((x) => x.key === f.platform);
  const transport = f.transport || p?.transports[0]?.name || "";
  const fields = credFields(p, transport);
  const stored = device?.credentials ?? {};

  const payload = (): DeviceInput => {
    const credentials: Record<string, string> = {};
    for (const k of fields) if (f.credentials[k]) credentials[k] = f.credentials[k];
    if (transport === "snmp" && !credentials.snmp_version) credentials.snmp_version = f.credentials.snmp_version || "2c";
    return { name: f.name, platform: f.platform, host: f.host.trim(), port: f.port, transport, verify_tls: f.verify_tls, site: f.site,
      location: f.location, role: f.role || p?.kind, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), note: f.note,
      enabled: f.enabled, poll_seconds: f.poll_seconds, flow_exporter_ip: f.flow_exporter_ip.trim(), use_system_key: f.use_system_key,
      credentials };
  };

  const test = useAction(() => api.devices.test({ ...payload(), id: device?.id }), {
    onSuccess: (r) => setTested(`${String(r.facts.model || r.facts.os || "устройство")} ${String(r.facts.version || "")} · интерфейсов ${r.interfaces}, соседей ${r.neighbors}, клиентов ${r.endpoints}${r.children ? `, устройств ${r.children}` : ""}`),
  });
  const save = useAction(() => (device ? api.devices.update(device.id, payload()) : api.devices.create(payload())), {
    success: device ? "Устройство сохранено" : "Устройство добавлено, идёт первый опрос", invalidate: [["devices"], ["device"], ["topology"]],
    onSuccess: onClose,
  });

  const options = useMemo(() => (platforms.data ?? []).map((x) => ({
    value: x.key, label: x.title, hint: `${x.vendor ? x.vendor + " · " : ""}${SEGMENT_LABEL[x.segment]} · ${ROLE_LABEL[x.kind] ?? x.kind}`,
  })), [platforms.data]);

  return (
    <Modal open={open} onClose={onClose} title={device ? `Устройство: ${device.name}` : "Добавить устройство"} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Платформа" hint={p?.hint}>
          <Select value={f.platform} options={options} menuWidth={420} onChange={(v) => set({ platform: v, transport: "", port: null })} />
        </Field>
        <Field label="Подключение">
          <Segmented layoutId="dev-transport" value={transport} onChange={(v) => set({ transport: v, port: null })}
            options={(p?.transports ?? []).map((t) => ({ value: t.name, label: TRANSPORT_LABEL[t.name] ?? t.name }))} />
        </Field>
        <Field label="Адрес (IP или имя хоста)">
          <input className="input mono" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="192.168.0.1" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Порт">
            <NumberInput value={f.port} allowEmpty min={1} max={65535} placeholder={String(p?.transports.find((t) => t.name === transport)?.port ?? "")}
              onChange={(v) => set({ port: v })} />
          </Field>
          <Field label="Опрос, с"><NumberInput value={f.poll_seconds} min={60} max={86400} step={60} onChange={(v) => set({ poll_seconds: v ?? 300 })} /></Field>
        </div>
        <Field label="Название" hint="пусто — имя с устройства"><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Роль">
          <Select value={f.role || p?.kind || "other"} onChange={(v) => set({ role: v })}
            options={Object.entries(ROLE_LABEL).filter(([k]) => k !== "gateway").map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Расположение" hint="площадка, этаж, шкаф"><input className="input" value={f.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        {p?.kind === "controller"
          ? <Field label="Сайт контроллера" hint="Omada / UniFi — сайт, Meraki — организация"><input className="input" value={f.site} onChange={(e) => set({ site: e.target.value })} /></Field>
          : <Field label="Адрес экспорта NetFlow / sFlow" hint="если отличается от адреса устройства"><input className="input mono" value={f.flow_exporter_ip} onChange={(e) => set({ flow_exporter_ip: e.target.value })} /></Field>}
      </div>

      <div className="mt-5 rounded-lg border border-base-700 bg-base-950/40 p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-medium text-slate-200">
          Учётные данные <span className="text-[11px] font-normal text-slate-500">хранятся только в OpenBao</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((k) => {
            const saved = stored[k] === true;
            if (k === "snmp_version") return (
              <Field key={k} label={CRED_LABEL[k]}>
                <Segmented layoutId="snmp-ver" value={f.credentials.snmp_version || "2c"} onChange={(v) => setCred(k, v)}
                  options={[{ value: "1", label: "v1" }, { value: "2c", label: "v2c" }, { value: "3", label: "v3" }]} />
              </Field>
            );
            if (k.startsWith("snmp_") && k !== "snmp_community" && (f.credentials.snmp_version || "2c") !== "3") return null;
            if (k === "snmp_auth_protocol" || k === "snmp_priv_protocol") return (
              <Field key={k} label={CRED_LABEL[k]}>
                <Select value={f.credentials[k] || (k === "snmp_auth_protocol" ? "sha" : "aes")} onChange={(v) => setCred(k, v)}
                  options={(k === "snmp_auth_protocol" ? ["md5", "sha", "sha256", "sha512"] : ["des", "3des", "aes", "aes256"]).map((x) => ({ value: x, label: x.toUpperCase() }))} />
              </Field>
            );
            if (k === "private_key") return (
              <Field key={k} label={CRED_LABEL[k]} hint={saved ? "сохранён — оставьте пустым, чтобы не менять" : "OpenSSH / PEM"}>
                <textarea className="input mono min-h-[70px] text-[11px]" value={f.credentials[k] ?? ""} onChange={(e) => setCred(k, e.target.value)}
                  placeholder={saved ? "••• сохранён •••" : "-----BEGIN OPENSSH PRIVATE KEY-----"} />
              </Field>
            );
            return (
              <Field key={k} label={CRED_LABEL[k] ?? k} hint={saved ? "сохранено — оставьте пустым, чтобы не менять" : undefined}>
                {SECRET_FIELDS.has(k)
                  ? <PasswordInput value={f.credentials[k] ?? ""} onChange={(e) => setCred(k, e.target.value)} placeholder={saved ? "•••••••• сохранено" : ""} autoComplete="new-password" />
                  : <input className="input" value={f.credentials[k] ?? ""} onChange={(e) => setCred(k, e.target.value)} autoComplete="off" />}
              </Field>
            );
          })}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {transport === "ssh" && <Checkbox checked={f.use_system_key} onChange={(v) => set({ use_system_key: v })} label="Использовать SSH-ключ панели (infra/ssh в OpenBao)" />}
          {["api", "https"].includes(transport) && <Checkbox checked={f.verify_tls} onChange={(v) => set({ verify_tls: v })} label="Проверять TLS-сертификат устройства" />}
          <Checkbox checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Опрашивать по расписанию" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Теги" hint="через запятую"><input className="input" value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Field>
        <Field label="Заметка"><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>

      {tested && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /> Подключение работает: {tested}</div>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {p && <Badge className="mr-auto">{p.vendor || "SNMP"} · {(p.capabilities[transport] ?? []).length} функций управления</Badge>}
        <button className="btn-ghost" disabled={!f.host || test.isPending} onClick={() => test.mutate(undefined)}><PlugZap size={14} /> {test.isPending ? "Проверяю…" : "Проверить подключение"}</button>
        <button className="btn-primary" disabled={!f.host || save.isPending} onClick={() => save.mutate(undefined)}><Save size={14} /> {device ? "Сохранить" : "Добавить"}</button>
      </div>
    </Modal>
  );
}
