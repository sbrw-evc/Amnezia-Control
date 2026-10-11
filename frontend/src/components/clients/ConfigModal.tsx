import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Link2, QrCode } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { copyText, useAction } from "@/lib/hooks";
import { Fmt } from "@/lib/format";
import { Modal, Segmented } from "@/components/ui/Primitives";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";

type Tab = "qr" | "conf" | "key";

export default function ConfigModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("qr");
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const q = useQuery({ queryKey: ["bundle", clientId], queryFn: () => api.clients.bundle(clientId!), enabled: !!clientId, staleTime: 0, gcTime: 0,
    refetchInterval: false, refetchOnWindowFocus: false });
  const share = useAction((hours: number) => api.clients.share(clientId!, hours), { onSuccess: (r) => { setLink(r); copyText(r.url, "Ссылка скопирована"); } });

  return (
    <Modal open={!!clientId} onClose={() => { setLink(null); onClose(); }} title={q.data ? `Конфигурация · ${q.data.name}` : "Конфигурация"} wide>
      {q.isLoading && <Skeleton className="h-72" />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented layoutId="cfg-tab" value={tab} onChange={setTab} options={[
              { value: "qr", label: <span className="flex items-center gap-1"><QrCode size={12} /> QR</span> },
              { value: "conf", label: ".conf" }, { value: "key", label: "vpn://" },
            ]} />
            <div className="flex gap-2">
              <a className="btn-ghost btn-sm" href={api.clients.downloadUrl(clientId!)}><Download size={14} /> Скачать .conf</a>
              <button className="btn-ghost btn-sm" onClick={() => share.mutate(24)} disabled={share.isPending}><Link2 size={14} /> Ссылка на 24 ч</button>
            </div>
          </div>
          {link && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 p-2 text-xs">
              <span className="mono flex-1 truncate text-blue-200">{link.url}</span>
              <span className="text-slate-400">до {Fmt.dateTime(link.expires_at)} · 3 открытия</span>
              <button className="btn-ghost btn-sm" onClick={() => copyText(link.url)}><Copy size={12} /></button>
            </motion.div>
          )}
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            {tab === "qr" && (
              <div className="grid items-center gap-5 sm:grid-cols-[260px_1fr]">
                <div className="qr" dangerouslySetInnerHTML={{ __html: q.data.qr_svg }} />
                <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
                  <li>Установите <b>AmneziaWG</b> (iOS / Android / Windows / macOS).</li>
                  <li>Нажмите «+» → «Сканировать QR-код» и наведите камеру.</li>
                  <li>Или используйте вкладку <b>vpn://</b> для приложения <b>Amnezia VPN</b>.</li>
                </ol>
              </div>
            )}
            {tab === "conf" && (
              <div className="relative">
                <pre className="mono max-h-80 overflow-auto rounded-lg border border-base-700 bg-base-950 p-3 text-slate-300">{q.data.config}</pre>
                <button className="btn-ghost btn-sm absolute right-2 top-2" onClick={() => copyText(q.data!.config)}><Copy size={12} /> Копировать</button>
              </div>
            )}
            {tab === "key" && (
              <div className="space-y-2">
                <textarea readOnly className="input mono h-40 break-all" value={q.data.amnezia_key} />
                <button className="btn-primary btn-sm" onClick={() => copyText(q.data!.amnezia_key)}><Copy size={12} /> Копировать ключ</button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </Modal>
  );
}
