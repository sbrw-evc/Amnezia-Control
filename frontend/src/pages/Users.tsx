import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, ShieldOff, Trash2, UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Fmt, ROLE_LABEL } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { PanelUser, Role } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Modal, Page, PageHeader } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";
import ApiTokens from "@/components/admin/ApiTokens";

const ROLES: { value: Role; hint: string }[] = [
  { value: "admin", hint: "всё, включая сервер, маршрутизацию, операторов и аудит" },
  { value: "operator", hint: "создание, блокировка и выдача конфигов клиентам" },
  { value: "viewer", hint: "только просмотр мониторинга и аналитики" },
];

function genPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => a[n % a.length]).join("");
}

export default function Users() {
  const me = useAuth((s) => s.user);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.users.list() });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", display_name: "", role: "operator" as Role, password: genPassword() });
  const inv = { invalidate: [["users"]] };
  const create = useAction((d: typeof form) => api.users.create(d), { ...inv, success: "Оператор добавлен", onSuccess: () => setCreating(false) });
  const update = useAction(({ id, d }: { id: number; d: Partial<PanelUser> }) => api.users.update(id, d), { ...inv, success: "Сохранено" });
  const reset = useAction(({ id, pw }: { id: number; pw: string }) => api.users.resetPassword(id, pw), { ...inv, success: "Пароль сброшен, сессии завершены" });
  const totpOff = useAction((id: number) => api.users.disableTotp(id), { ...inv, success: "2FA отключена" });
  const remove = useAction((id: number) => api.users.remove(id), { ...inv, success: "Оператор удалён" });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(form); };

  return (
    <Page>
      <PageHeader title="Доступ к панели" icon={<UserCog size={20} />} subtitle="Операторы панели и их роли. Пароли хранятся как argon2-хеши, секреты 2FA — в OpenBao."
        actions={<button className="btn-primary" onClick={() => { setForm({ username: "", display_name: "", role: "operator", password: genPassword() }); setCreating(true); }}><Plus size={16} /> Добавить</button>} />
      <Card bodyClass="p-0">
        <table className="table-ac">
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>2FA</th><th>Последний вход</th><th /></tr></thead>
          <tbody>
            {users.isLoading && <tr><td colSpan={6}><Skeleton className="h-24" /></td></tr>}
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium text-slate-100">{u.display_name || u.username} {u.id === me?.id && <Badge tone="blue">вы</Badge>}</div>
                  <div className="mono text-slate-500">{u.username}</div>
                </td>
                <td>
                  <select className="input !w-auto !py-1 text-xs" value={u.role} disabled={u.id === me?.id}
                    onChange={(e) => update.mutate({ id: u.id, d: { role: e.target.value as Role } })}>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{ROLE_LABEL[r.value]}</option>)}
                  </select>
                </td>
                <td className="space-x-1">
                  {u.is_active ? <Badge tone="green">активен</Badge> : <Badge tone="red">отключён</Badge>}
                  {u.must_change_password && <Badge tone="amber">смена пароля</Badge>}
                  {u.locked && <Badge tone="red">блок. после попыток</Badge>}
                </td>
                <td>{u.totp_enabled ? <Badge tone="green"><ShieldCheck size={10} /> вкл</Badge> : <Badge>выкл</Badge>}</td>
                <td className="text-xs text-slate-400">{Fmt.ago(u.last_login_at)}</td>
                <td>
                  {u.id !== me?.id && (
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost btn-sm" onClick={() => update.mutate({ id: u.id, d: { is_active: !u.is_active } })}>{u.is_active ? "Отключить" : "Включить"}</button>
                      <button className="btn-ghost btn-sm" title="Сбросить пароль" onClick={async () => {
                        const pw = genPassword();
                        if (await confirm({ title: "Сбросить пароль?", message: `Новый временный пароль для ${u.username}: ${pw}\nСкопируйте его — после подтверждения он больше не будет показан. Пользователь сменит его при входе.`, confirmLabel: "Сбросить" }))
                          reset.mutate({ id: u.id, pw });
                      }}><KeyRound size={14} /></button>
                      {u.totp_enabled && <button className="btn-ghost btn-sm" title="Отключить 2FA" onClick={() => totpOff.mutate(u.id)}><ShieldOff size={14} /></button>}
                      <button className="btn-danger btn-sm" onClick={async () => {
                        if (await confirm({ title: "Удалить оператора?", message: `${u.username} потеряет доступ к панели.`, danger: true, confirmLabel: "Удалить" })) remove.mutate(u.id);
                      }}><Trash2 size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ApiTokens />

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый оператор">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Логин"><input className="input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Имя"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          </div>
          <Field label="Роль">
            <div className="space-y-2">
              {ROLES.map((r) => (
                <label key={r.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-base-700 p-3 hover:border-base-600">
                  <input type="radio" name="role" checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} className="mt-1" />
                  <span><span className="block text-sm text-white">{ROLE_LABEL[r.value]}</span><span className="text-xs text-slate-500">{r.hint}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Временный пароль" hint="пользователь сменит его при первом входе">
            <div className="flex gap-2"><input className="input mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="btn-ghost" onClick={() => setForm({ ...form, password: genPassword() })}>↻</button></div>
          </Field>
          <div className="flex justify-end"><button className="btn-primary" disabled={create.isPending}>Создать</button></div>
        </form>
      </Modal>
    </Page>
  );
}
