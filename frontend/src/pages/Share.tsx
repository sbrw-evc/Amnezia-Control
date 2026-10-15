import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, Copy, Download } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { copyText } from "@/lib/hooks";
import { t } from "@/i18n";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";

/** A translated text with React nodes in place of its {placeholders}. */
const rich = (s: string, parts: Record<string, ReactNode>) =>
  s.split(/(\{\w+\})/).map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : p}</Fragment>;
  });

/** Public page of a one-time config link: no shell, a card on the chrome background of the current theme. */
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
    <div className="flex min-h-screen items-center justify-center bg-chrome p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-[18px] sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent"><Activity size={20} /></div>
          <div className="min-w-0">
            <div className="text-[17px] font-semibold text-fg">{t("Your VPN access")}</div>
            <div className="truncate text-xs text-slate-400">{q.data?.name}</div>
          </div>
        </div>
        {q.error ? <ErrorState error={q.error} /> : q.data && (
          <div className="space-y-4">
            <div className="qr mx-auto max-w-[280px]" dangerouslySetInnerHTML={{ __html: q.data.qr_svg }} />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>{rich(t("Install the {a} or {b} app."), { a: <b className="text-fg">AmneziaWG</b>, b: <b className="text-fg">Amnezia VPN</b> })}</li>
              <li>{t("Scan the QR code or import the file.")}</li>
            </ol>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={download}><Download size={16} /> {t("Download .conf")}</button>
              <button className="btn-ghost flex-1" onClick={() => copyText(q.data!.amnezia_key, t("Key copied"))}><Copy size={16} /> {t("vpn:// key")}</button>
            </div>
            <p className="text-center text-xs text-slate-500">{t("This link is single-use and will soon stop working. Do not forward it.")}</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
