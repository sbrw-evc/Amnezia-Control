import { useState, type FormEvent } from "react";
import clsx from "clsx";
import type { ClientInput } from "@/lib/api";
import type { ServerKind, VpnClient, VpnServer } from "@/lib/types";
import { Field, Segmented } from "@/components/ui/Primitives";
import { NumberInput } from "@/components/ui/Controls";

const GB = 1024 ** 3;
const VALIDITY = [
  { label: "∞", days: null }, { label: "7 дн", days: 7 }, { label: "30 дн", days: 30 }, { label: "90 дн", days: 90 }, { label: "1 год", days: 365 },
];

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function ClientForm({ initial, submitLabel, busy, onSubmit, servers }: {
  initial?: Partial<VpnClient>; submitLabel: string; busy?: boolean; onSubmit: (d: ClientInput) => void; servers?: VpnServer[];
}) {
  const [server, setServer] = useState<ServerKind>("amnezia");
  const current = servers?.find((s) => s.kind === server);
  const [name, setName] = useState(initial?.name ?? "");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [note, setNote] = useState(initial?.note ?? "");
  const [expires, setExpires] = useState(toLocalInput(initial?.expires_at));
  const [quota, setQuota] = useState(initial?.quota_bytes ? String(+(initial.quota_bytes / GB).toFixed(2)) : "");

  const preset = (days: number | null) => setExpires(days === null ? "" : toLocalInput(new Date(Date.now() + days * 86400000).toISOString()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(), owner: owner.trim(), contact: contact.trim(), note,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      expires_at: expires ? new Date(expires).toISOString() : null,
      quota_gb: quota ? Number(quota) : null,
      ...(servers ? { server } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {servers && servers.length > 1 && (
        <Field label="VPN-сервер" hint={current && !current.ready ? "WireGuard на MikroTik не настроен — настройте его на странице «VPN на MikroTik»" : server === "mikrotik" ? "WireGuard на домашнем роутере: доступ к локальной сети и сайты из списка через Amnezia" : "AmneziaWG на VPS с обфускацией трафика"}>
          <Segmented layoutId="client-server" value={server} onChange={setServer}
            options={servers.map((s) => ({ value: s.kind, label: s.title }))} />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Имя *"><input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone Анны" /></Field>
        <Field label="Владелец"><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Анна" /></Field>
        <Field label="Контакт"><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@telegram / email" /></Field>
        <Field label="Теги" hint="через запятую: семья, работа"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      </div>
      <Field label="Срок доступа" hint="по истечении клиент блокируется автоматически">
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" className="input max-w-[230px]" value={expires} onChange={(e) => setExpires(e.target.value)} />
          {VALIDITY.map((v) => (
            <button type="button" key={v.label} onClick={() => preset(v.days)}
              className={clsx("chip", (v.days === null && !expires) && "chip-on")}>{v.label}</button>
          ))}
        </div>
      </Field>
      <Field label="Месячная квота, ГБ" hint="пусто — без ограничений; при превышении блокировка до 1-го числа">
        <NumberInput className="max-w-[200px]" value={quota ? Number(quota) : null} min={0} step={0.5} allowEmpty placeholder="∞"
          onChange={(v) => setQuota(v === null ? "" : String(v))} />
      </Field>
      <Field label="Заметка"><textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy || !name.trim() || (current && !current.ready)}>{submitLabel}</button></div>
    </form>
  );
}
