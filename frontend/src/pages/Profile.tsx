import { useQuery } from "@tanstack/react-query";
import { KeyRound, LogOut, Monitor, ShieldCheck, UserCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Fmt, ROLE_LABEL } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Page, PageHeader } from "@/components/ui/Primitives";
import PasswordInput from "@/components/ui/PasswordInput";

export default function Profile() {
  const { user, bootstrap } = useAuth();
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [totp, setTotp] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.auth.sessions() });

  const change = useAction(() => api.auth.changePassword(pw.current, pw.next), {
    success: "Пароль изменён, остальные сессии завершены", invalidate: [["sessions"]],
    onSuccess: () => { setPw({ current: "", next: "", repeat: "" }); bootstrap(); },
  });
  const setup = useAction(() => api.auth.totpSetup(), { onSuccess: (r) => setTotp(r) });
  const enable = useAction(() => api.auth.totpEnable(code), { success: "Двухфакторная аутентификация включена", onSuccess: () => { setTotp(null); setCode(""); bootstrap(); } });
  const disable = useAction(() => api.auth.totpDisable(), { success: "2FA отключена", onSuccess: () => bootstrap() });
  const revoke = useAction((id: string) => api.auth.revokeSession(id), { invalidate: [["sessions"]] });

  const submit = (e: FormEvent) => { e.preventDefault(); change.mutate(undefined); };
  const mismatch = pw.repeat !== "" && pw.next !== pw.repeat;

  return (
    <Page>
      <PageHeader title="Профиль и безопасность" icon={<UserCircle size={20} />}
        subtitle={<>{user?.display_name || user?.username} · {ROLE_LABEL[user?.role ?? "viewer"]}</>} />
      {user?.must_change_password && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Задайте собственный пароль, чтобы продолжить работу с панелью.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><KeyRound size={14} /> Смена пароля</span>}>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Текущий пароль"><PasswordInput autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="Новый пароль" hint="не короче 10 символов, буквы разного регистра или цифры"><PasswordInput autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Повторите" hint={mismatch ? <span className="text-red-300">пароли не совпадают</span> : undefined}><PasswordInput autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            <button className="btn-primary" disabled={!pw.current || !pw.next || mismatch || change.isPending}>Сменить пароль</button>
          </form>
        </Card>

        <Card title={<span className="flex items-center gap-2"><ShieldCheck size={14} /> Двухфакторная аутентификация</span>}>
          {user?.totp_enabled ? (
            <div className="space-y-3">
              <Badge tone="green"><ShieldCheck size={12} /> Включена</Badge>
              <p className="text-sm text-slate-400">При входе запрашивается код из приложения-аутентификатора. Секрет хранится в OpenBao.</p>
              <button className="btn-danger" onClick={() => disable.mutate(undefined)}>Отключить 2FA</button>
            </div>
          ) : totp ? (
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <div className="qr" dangerouslySetInnerHTML={{ __html: totp.qr_svg }} />
              <div className="space-y-3">
                <p className="text-sm text-slate-300">Отсканируйте QR в Google Authenticator, Aegis или 1Password и введите код.</p>
                <div className="mono break-all text-xs text-slate-500">{totp.secret}</div>
                <input className="input text-center font-mono text-xl tracking-[.4em]" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                <button className="btn-primary" disabled={code.length < 6 || enable.isPending} onClick={() => enable.mutate(undefined)}>Подтвердить и включить</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Защитите вход одноразовыми кодами (TOTP).</p>
              <button className="btn-primary" onClick={() => setup.mutate(undefined)}>Настроить 2FA</button>
            </div>
          )}
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><Monitor size={14} /> Активные сессии</span>} bodyClass="p-0">
        <table className="table-ac">
          <thead><tr><th>Устройство</th><th>IP</th><th>Создана</th><th>Активность</th><th /></tr></thead>
          <tbody>
            {sessions.data?.map((s) => (
              <tr key={s.id}>
                <td className="max-w-[360px] truncate text-slate-300" title={s.user_agent}>{s.user_agent || "—"} {s.current && <Badge tone="blue">текущая</Badge>}</td>
                <td className="mono text-slate-400">{s.ip}</td>
                <td className="text-xs text-slate-400">{Fmt.dateTime(s.created_at)}</td>
                <td className="text-xs text-slate-400">{Fmt.ago(s.last_seen_at)}</td>
                <td>{!s.current && <button className="btn-ghost btn-sm" onClick={() => revoke.mutate(s.id)}><LogOut size={12} /> Завершить</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
