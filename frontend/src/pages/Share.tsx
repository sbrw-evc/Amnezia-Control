import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, Copy, Download } from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { copyText } from "@/lib/hooks";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";

export default function SharePage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["share", token], queryFn: () => api.clients.publicShare(token), retry: false, staleTime: Infinity,
    refetchInterval: false, refetchOnWindowFocus: false });

  const download = () => {
    if (!q.data) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([q.data.config], { type: "text/plain" }));
    a.download = `${q.data.name.replace(/[^\w-]+/g, "_") || "vpn"}.conf`;
    a.click();
  };

  if (q.isLoading) return <PageLoader full />;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600"><Activity className="text-white" size={20} /></div>
          <div><div className="font-semibold text-white">Ваш доступ к VPN</div><div className="text-xs text-slate-400">{q.data?.name}</div></div>
        </div>
        {q.error ? <ErrorState error={q.error} /> : q.data && (
          <div className="space-y-4">
            <div className="qr mx-auto max-w-[280px]" dangerouslySetInnerHTML={{ __html: q.data.qr_svg }} />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>Установите приложение <b>AmneziaWG</b> или <b>Amnezia VPN</b>.</li>
              <li>Отсканируйте QR-код или импортируйте файл.</li>
            </ol>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={download}><Download size={16} /> Скачать .conf</button>
              <button className="btn-ghost flex-1" onClick={() => copyText(q.data!.amnezia_key, "Ключ скопирован")}><Copy size={16} /> Ключ vpn://</button>
            </div>
            <p className="text-center text-xs text-slate-500">Ссылка одноразовая и скоро перестанет работать. Не пересылайте её.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
