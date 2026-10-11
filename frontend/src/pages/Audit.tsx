import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileClock, Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useLive } from "@/lib/live";
import { Badge, Card, Page, PageHeader, type Tone } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";

const ACTIONS: Record<string, [string, Tone]> = {
  "auth.login": ["Вход", "green"], "auth.login_failed": ["Неудачный вход", "red"], "auth.password_changed": ["Смена пароля", "blue"],
  "auth.2fa_enabled": ["2FA включена", "green"], "auth.2fa_disabled": ["2FA отключена", "amber"],
  "client.created": ["Клиент создан", "green"], "client.updated": ["Клиент изменён", "blue"], "client.deleted": ["Клиент удалён", "red"],
  "client.blocked": ["Блокировка", "amber"], "client.unblocked": ["Разблокировка", "green"], "client.reissued": ["Перевыпуск ключей", "violet"],
  "client.config_viewed": ["Выдача конфига", "slate"], "client.share_link_created": ["Ссылка создана", "violet"], "client.share_link_used": ["Ссылка открыта", "violet"],
  "client.sync": ["Синхронизация", "slate"], "server.config_saved": ["Конфиг сервера", "red"], "routing.site_list_applied": ["Список сайтов", "blue"],
  "settings.updated": ["Настройки", "blue"], "panel_user.created": ["Оператор добавлен", "green"], "panel_user.updated": ["Оператор изменён", "blue"],
  "panel_user.deleted": ["Оператор удалён", "red"], "panel_user.password_reset": ["Сброс пароля", "amber"],
};
const PAGE = 50;

export default function Audit() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useQuery({ queryKey: ["audit", q, action, offset], queryFn: () => api.ops.audit({ q, action, offset, limit: PAGE }), placeholderData: keepPreviousData });
  useLive("audit", () => data.refetch(), []);

  return (
    <Page>
      <PageHeader title="Журнал аудита" icon={<FileClock size={20} />} subtitle="Кто, что и когда менял в системе" />
      <div className="card flex flex-wrap gap-2 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Поиск по объекту или действию" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <select className="input !w-auto" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
          <option value="">Все действия</option>
          <option value="client.">Клиенты</option><option value="auth.">Аутентификация</option>
          <option value="panel_user.">Операторы</option><option value="server.">Сервер</option>
          <option value="routing.">Маршрутизация</option><option value="settings.">Настройки</option>
        </select>
      </div>
      <Card bodyClass="p-0">
        <table className="table-ac">
          <thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th><th>IP</th></tr></thead>
          <tbody>
            {data.isLoading && <tr><td colSpan={6}><Skeleton className="h-40" /></td></tr>}
            {data.data?.items.map((e) => {
              const [label, tone] = ACTIONS[e.action] ?? [e.action, "slate" as Tone];
              return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-slate-400">{Fmt.dateTime(e.ts)}</td>
                  <td className="text-slate-200">{e.actor}</td>
                  <td><Badge tone={tone}>{label}</Badge></td>
                  <td className="text-slate-300">{e.target_name || "—"}</td>
                  <td className="mono max-w-[360px] truncate text-slate-500" title={JSON.stringify(e.details)}>
                    {Object.entries(e.details).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}
                  </td>
                  <td className="mono text-slate-500">{e.ip}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-base-700/60 px-4 py-2 text-xs text-slate-400">
          <span>Всего: {data.data?.total ?? 0}</span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Назад</button>
            <button className="btn-ghost btn-sm" disabled={!data.data || offset + PAGE >= data.data.total} onClick={() => setOffset(offset + PAGE)}>Вперёд →</button>
          </div>
        </div>
      </Card>
    </Page>
  );
}
