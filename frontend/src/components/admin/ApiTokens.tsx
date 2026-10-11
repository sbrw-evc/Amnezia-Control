import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Fmt, ROLE_LABEL } from "@/lib/format";
import { copyText, useAction } from "@/lib/hooks";
import type { ApiTokenInfo, Role } from "@/lib/types";
import { Badge, Card, Field, Modal } from "@/components/ui/Primitives";
import { confirm } from "@/components/ui/Confirm";

export default function ApiTokens() {
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api.admin.tokens() });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", role: "viewer" as Role, days: "90" });
  const [issued, setIssued] = useState<ApiTokenInfo | null>(null);
  const create = useAction((d: typeof form) => api.admin.createToken({ name: d.name, role: d.role, days: d.days ? Number(d.days) : null }), {
    invalidate: [["tokens"]], onSuccess: (t) => { setOpen(false); setIssued(t); },
  });
  const revoke = useAction((id: number) => api.admin.revokeToken(id), { success: "Токен отозван", invalidate: [["tokens"]] });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(form); };

  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound size={14} /> API-токены</span>}
      actions={<button className="btn-ghost btn-sm" onClick={() => { setForm({ name: "", role: "viewer", days: "90" }); setOpen(true); }}><Plus size={14} /> Выпустить</button>}
      bodyClass="p-0">
      <table className="table-ac">
        <thead><tr><th>Название</th><th>Префикс</th><th>Роль</th><th>Истекает</th><th>Использован</th><th>Создал</th><th /></tr></thead>
        <tbody>
          {tokens.data?.map((t) => (
            <tr key={t.id}>
              <td className="text-slate-200">{t.name}</td>
              <td className="mono text-slate-400">{t.prefix}…</td>
              <td><Badge tone={t.role === "admin" ? "red" : t.role === "operator" ? "amber" : "blue"}>{ROLE_LABEL[t.role]}</Badge></td>
              <td className="text-xs text-slate-400">{t.expires_at ? Fmt.dateTime(t.expires_at) : "бессрочно"}</td>
              <td className="text-xs text-slate-400">{Fmt.ago(t.last_used_at)}</td>
              <td className="text-xs text-slate-400">{t.created_by}</td>
              <td><button className="btn-danger btn-sm" onClick={async () => {
                if (await confirm({ title: "Отозвать токен?", message: `Интеграции, использующие «${t.name}», перестанут работать.`, danger: true, confirmLabel: "Отозвать" }))
                  revoke.mutate(t.id);
              }}><Trash2 size={12} /></button></td>
            </tr>
          ))}
          {tokens.data && !tokens.data.length && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Токенов нет. Используйте их для интеграций: <span className="mono">Authorization: Bearer ac_…</span>, документация — <a className="text-blue-300" href="/api/docs" target="_blank" rel="noreferrer">/api/docs</a></td></tr>}
        </tbody>
      </table>

      <Modal open={open} onClose={() => setOpen(false)} title="Новый API-токен">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Название"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Home Assistant" /></Field>
          <Field label="Роль">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="viewer">{ROLE_LABEL.viewer}</option><option value="operator">{ROLE_LABEL.operator}</option><option value="admin">{ROLE_LABEL.admin}</option>
            </select>
          </Field>
          <Field label="Срок действия, дней" hint="пусто — бессрочно"><input className="input" type="number" min={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
          <div className="flex justify-end"><button className="btn-primary" disabled={create.isPending}>Выпустить</button></div>
        </form>
      </Modal>
      <Modal open={!!issued} onClose={() => setIssued(null)} title="Токен выпущен">
        <p className="text-sm text-slate-300">Скопируйте токен сейчас — повторно он показан не будет.</p>
        <div className="mt-3 flex gap-2">
          <input readOnly className="input mono" value={issued?.token ?? ""} />
          <button className="btn-primary" onClick={() => copyText(issued?.token ?? "")}><Copy size={14} /></button>
        </div>
      </Modal>
    </Card>
  );
}
