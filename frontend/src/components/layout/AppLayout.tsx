import { AnimatePresence, motion } from "framer-motion";
import { Menu, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { notify } from "@/lib/notify";
import NotificationCenter, { NotificationBell } from "./NotificationCenter";
import { useLiveQuerySync } from "@/lib/liveSync";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import { ConfirmHost } from "@/components/ui/Confirm";
import { useLive } from "@/lib/live";

const KEY = "amnezia-control.sidebar.collapsed";

export default function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [notices, setNotices] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? "1" : "0"); } catch {  }
  }, [collapsed]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useLiveQuerySync();
  useLive("alert", (d: { title?: string; severity?: string; resolved?: boolean }) => {
    if (!d.title) return;
    if (d.resolved) notify.success("Алерт решён", d.title);
    else if (d.severity === "critical") notify.error(d.title, "Критичный алерт");
    else if (d.severity === "warning") notify.warning(d.title);
    else notify.info(d.title);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(99,102,241,.06),transparent_50%)]">
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} onNotifications={() => setNotices(true)} />
      </div>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <motion.div className="relative h-full w-[248px]" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}>
              <Sidebar collapsed={false} onToggle={() => undefined} onNavigate={() => setMobileOpen(false)} onNotifications={() => { setMobileOpen(false); setNotices(true); }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-base-700/60 px-4 py-2 lg:hidden">
          <button className="rounded-md p-2 text-slate-300 hover:bg-base-800" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <span className="font-semibold text-white">Amnezia Control</span>
          <div className="ml-auto flex items-center gap-1"><NotificationBell onOpen={() => setNotices(true)} />
          <button className="rounded-md p-2 text-slate-300 hover:bg-base-800" onClick={() => setPalette(true)}><Search size={18} /></button></div>
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-6 lg:px-8">{children}</div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <NotificationCenter open={notices} onClose={() => setNotices(false)} />
      <ConfirmHost />
    </div>
  );
}
