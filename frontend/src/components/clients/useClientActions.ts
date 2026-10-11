import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { VpnClient } from "@/lib/types";
import { confirm } from "@/components/ui/Confirm";

const INVALIDATE = [["clients"], ["client"], ["summary"]];

export function useClientActions(onDeleted?: () => void) {
  const block = useAction((id: string) => api.clients.block(id), { success: "Клиент заблокирован", invalidate: INVALIDATE });
  const unblock = useAction((id: string) => api.clients.unblock(id), { success: "Клиент разблокирован", invalidate: INVALIDATE });
  const reissue = useAction((id: string) => api.clients.reissue(id), { success: "Ключи перевыпущены", invalidate: INVALIDATE });
  const remove = useAction((id: string) => api.clients.remove(id), { success: "Клиент удалён", invalidate: INVALIDATE, onSuccess: onDeleted });

  return {
    pending: block.isPending || unblock.isPending || reissue.isPending || remove.isPending,
    toggleBlock: (c: VpnClient) => (c.status === "blocked" ? unblock : block).mutate(c.id),
    reissue: async (c: VpnClient) => {
      if (await confirm({ title: "Перевыпустить ключи?", message: `Текущий конфиг «${c.name}» перестанет работать. Адрес, статистика и настройки сохранятся.`, confirmLabel: "Перевыпустить" }))
        return reissue.mutateAsync(c.id);
    },
    remove: async (c: VpnClient) => {
      if (await confirm({ title: "Удалить клиента?", message: `«${c.name}» будет удалён с сервера вместе с ключами и историей. Действие необратимо.`, confirmLabel: "Удалить", danger: true }))
        remove.mutate(c.id);
    },
  };
}
