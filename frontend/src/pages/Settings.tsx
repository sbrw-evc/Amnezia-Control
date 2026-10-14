import { useQuery } from "@tanstack/react-query";
import { Bell, Save, Send, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Settings } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Page, PageHeader } from "@/components/ui/Primitives";
import PasswordInput from "@/components/ui/PasswordInput";
import { Checkbox, NumberInput, Select } from "@/components/ui/Controls";
import { Skeleton } from "@/components/ui/Feedback";

type Def = { key: string; label: string; hint?: string; type: "text" | "number" | "bool" | "select"; options?: [string, string][] };
const GROUPS: { title: string; fields: Def[] }[] = [
  { title: "Конфиги клиентов", fields: [
    { key: "client_dns", label: "DNS для клиентов", hint: "через запятую", type: "text" },
    { key: "endpoint_host", label: "Адрес сервера в конфигах", hint: "пусто — AWG_HOST", type: "text" },
    { key: "share_link_hours", label: "Срок жизни ссылки на конфиг, ч", type: "number" },
  ] },
  { title: "Политики по умолчанию", fields: [
    { key: "default_quota_gb", label: "Квота по умолчанию, ГБ/мес", hint: "пусто — без ограничений", type: "number" },
    { key: "default_valid_days", label: "Срок доступа по умолчанию, дней", hint: "пусто — бессрочно", type: "number" },
    { key: "quota_warn_percent", label: "Предупреждать при использовании квоты, %", type: "number" },
    { key: "expiry_warn_days", label: "Предупреждать об окончании доступа за, дней", type: "number" },
  ] },
  { title: "Мониторинг", fields: [
    { key: "poll_seconds", label: "Интервал опроса сервера, с", type: "number" },
    { key: "retention_days", label: "Хранить статистику, дней", type: "number" },
    { key: "gateway_stale_minutes", label: "Алерт, если шлюз молчит дольше, мин", type: "number" },
    { key: "timezone", label: "Часовой пояс отчётов", type: "text" },
  ] },
  { title: "Уведомления", fields: [
    { key: "notify_enabled", label: "Отправлять уведомления", type: "bool" },
    { key: "notify_min_severity", label: "Минимальная важность", type: "select",
      options: [["info", "Инфо"], ["warning", "Внимание"], ["critical", "Критично"]] },
    { key: "notify_telegram_chat_id", label: "Telegram chat id", hint: "id пользователя, группы или канала", type: "text" },
  ] },
  { title: "Сеть и устройства", fields: [
    { key: "endpoint_offline_minutes", label: "Клиент считается офлайн через, мин", type: "number" },
    { key: "endpoint_retention_days", label: "Забывать неактивных клиентов через, дней", type: "number" },
    { key: "flow_collector_host", label: "Адрес коллектора для экспорта потоков", hint: "пусто — GATEWAY_IP", type: "text" },
    { key: "flow_collector_port", label: "Порт NetFlow / IPFIX", type: "number" },
  ] },
  { title: "Анализ трафика", fields: [
    { key: "threat_enabled", label: "Проверять адреса по спискам угроз", type: "bool" },
    { key: "threat_refresh_hours", label: "Обновлять списки угроз раз в, ч", type: "number" },
    { key: "threat_exclude", label: "Не помечать сети", hint: "свои публичные адреса, через пробел", type: "text" },
    { key: "rdns_enabled", label: "Определять имена удалённых хостов (PTR)", type: "bool" },
  ] },
  { title: "Резервное копирование", fields: [
    { key: "backup_enabled", label: "Ежедневная резервная копия", type: "bool" },
    { key: "backup_keep", label: "Хранить копий", type: "number" },
  ] },
];

function TelegramCard({ isAdmin }: { isAdmin: boolean }) {
  const status = useQuery({ queryKey: ["notifications"], queryFn: () => api.admin.notifications() });
  const [token, setToken] = useState("");
  const save = useAction((t: string) => api.admin.setTelegramToken(t), { success: (r) => `Бот @${r.bot} подключён`, invalidate: [["notifications"]], onSuccess: () => setToken("") });
  const test = useAction(() => api.admin.testNotification(), { success: "Тестовое сообщение отправлено" });
  return (
    <Card title={<span className="flex items-center gap-2"><Bell size={14} /> Telegram-бот</span>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          {status.data?.configured ? <Badge tone="green">настроен{status.data.bot ? ` · @${status.data.bot}` : ""}</Badge>
            : status.data?.bot ? <Badge tone="amber">@{status.data.bot} · укажите chat id</Badge> : <Badge>не настроен</Badge>}
        </div>
        <p className="text-xs text-slate-500">Создайте бота у @BotFather и вставьте токен. Он будет сохранён в OpenBao и больше не отображается.</p>
        {isAdmin && <>
          <div className="flex gap-2">
            <PasswordInput className="mono" placeholder="123456:ABC-DEF…" value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn-ghost" disabled={!token || save.isPending} onClick={() => save.mutate(token)}><Save size={14} /></button>
          </div>
          <button className="btn-ghost btn-sm" disabled={!status.data?.configured || test.isPending} onClick={() => test.mutate(undefined)}><Send size={12} /> Тестовое сообщение</button>
        </>}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.ops.settings(), refetchInterval: false, refetchOnWindowFocus: false });
  const [form, setForm] = useState<Settings>({});
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useAction((s: Settings) => api.ops.saveSettings(s), { success: "Настройки сохранены", invalidate: [["settings"]] });

  const set = (d: Def, v: string | boolean) =>
    setForm({ ...form, [d.key]: d.type === "number" ? (v === "" ? null : Number(v)) : v });

  const input = (d: Def) => {
    if (d.type === "bool") return <Checkbox disabled={!isAdmin} checked={!!form[d.key]} onChange={(v) => set(d, v)} label={d.label} />;
    const control = d.type === "select"
      ? <Select disabled={!isAdmin} value={String(form[d.key] ?? "")} onChange={(v) => set(d, v)}
          options={(d.options ?? []).map(([v, l]) => ({ value: v, label: l }))} />
      : d.type === "number"
        ? <NumberInput disabled={!isAdmin} allowEmpty placeholder="—" value={form[d.key] === null || form[d.key] === "" ? null : Number(form[d.key])}
            min={0} onChange={(v) => setForm({ ...form, [d.key]: v })} />
        : <input className="input" disabled={!isAdmin} value={String(form[d.key] ?? "")} onChange={(e) => set(d, e.target.value)} />;
    return <Field label={d.label} hint={d.hint}>{control}</Field>;
  };

  return (
    <Page>
      <PageHeader title="Настройки" icon={<SettingsIcon size={20} />} subtitle={isAdmin ? "Параметры панели и бизнес-правил" : "Только просмотр"}
        actions={isAdmin && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(form)}><Save size={16} /> Сохранить</button>} />
      {!q.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4 xl:grid-cols-3">
          {GROUPS.map((g) => (
            <Card key={g.title} title={g.title}>
              <div className="space-y-4">{g.fields.map((d) => <div key={d.key}>{input(d)}</div>)}</div>
            </Card>
          ))}
          <TelegramCard isAdmin={isAdmin} />
        </div>
      )}
    </Page>
  );
}
