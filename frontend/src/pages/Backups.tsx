import { useQuery } from "@tanstack/react-query";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Archive, Download, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { Card, Page, PageHeader } from "@/components/ui/Primitives";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";

export default function Backups() {
  const list = useQuery({ queryKey: ["backups"], queryFn: () => api.admin.backups() });
  const create = useAction(() => api.admin.createBackup(), { success: (r) => `Создана копия ${r.name}`, invalidate: [["backups"]] });
  const remove = useAction((name: string) => api.admin.deleteBackup(name), { success: "Копия удалена", invalidate: [["backups"]] });
  const [rows] = useAutoAnimate<HTMLTableSectionElement>();

  return (
    <Page>
      <PageHeader title="Резервные копии" icon={<Archive size={20} />}
        subtitle="База данных PostgreSQL и зашифрованный снапшот OpenBao. Ежедневно и по требованию."
        actions={<button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(undefined)}><Plus size={16} /> {create.isPending ? "Создаю…" : "Создать копию"}</button>} />
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <div>Снапшот OpenBao зашифрован ключом автоматической распечатки (<code className="mono">openbao/keys/unseal.key</code>).
          Без этого ключа восстановить секреты невозможно — храните его отдельно от архивов. Порядок восстановления описан в Wiki.</div>
      </div>
      <Card bodyClass="p-0">
        <table className="table-nc">
          <thead><tr><th>Архив</th><th>Создан</th><th>Размер</th><th /></tr></thead>
          <tbody ref={rows}>
            {list.isLoading && <tr><td colSpan={4}><Skeleton className="h-24" /></td></tr>}
            {list.data?.map((b) => (
              <tr key={b.name}>
                <td className="mono text-slate-200">{b.name}</td>
                <td className="text-slate-400">{Fmt.dateTime(b.created_at)} <span className="text-xs text-slate-600">({Fmt.ago(b.created_at)})</span></td>
                <td className="mono">{Fmt.bytes(b.size)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <a className="btn-ghost btn-sm" href={api.admin.backupUrl(b.name)}><Download size={14} /> Скачать</a>
                    <button className="btn-danger btn-sm" onClick={async () => {
                      if (await confirm({ title: "Удалить копию?", message: b.name, danger: true, confirmLabel: "Удалить" })) remove.mutate(b.name);
                    }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.length && <EmptyState title="Копий пока нет" hint="Первая автоматическая копия создаётся через 30 минут после запуска" />}
      </Card>
    </Page>
  );
}
