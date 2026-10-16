import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { t } from "@/i18n";
import type { VpnClient } from "@/lib/types";
import { confirm } from "@/components/ui/Confirm";

const INVALIDATE = [["clients"], ["client"], ["summary"]];

export function useClientActions(onDeleted?: () => void) {
  const block = useAction((id: string) => api.clients.block(id), { success: t("Client blocked"), invalidate: INVALIDATE });
  const unblock = useAction((id: string) => api.clients.unblock(id), { success: t("Client unblocked"), invalidate: INVALIDATE });
  const reissue = useAction((id: string) => api.clients.reissue(id), { success: t("New keys issued"), invalidate: INVALIDATE });
  const remove = useAction((id: string) => api.clients.remove(id), { success: t("Client deleted"), invalidate: INVALIDATE, onSuccess: onDeleted });

  return {
    pending: block.isPending || unblock.isPending || reissue.isPending || remove.isPending,
    toggleBlock: (c: VpnClient) => (c.status === "blocked" ? unblock : block).mutate(c.id),
    reissue: async (c: VpnClient) => {
      if (await confirm({ title: t("Reissue the keys?"), confirmLabel: t("Reissue"),
        message: t("The current config of “{name}” will stop working. The address, statistics and settings are kept.", { name: c.name }) }))
        return reissue.mutateAsync(c.id);
    },
    remove: async (c: VpnClient) => {
      if (await confirm({ title: t("Delete the client?"), confirmLabel: t("Delete"), danger: true,
        message: t("“{name}” will be deleted from the server together with its keys and history. This cannot be undone.", { name: c.name }) }))
        remove.mutate(c.id);
    },
  };
}
