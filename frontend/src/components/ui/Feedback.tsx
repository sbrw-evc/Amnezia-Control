import { motion } from "framer-motion";
import { AlertTriangle, Inbox } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";

export function PageLoader({ full = false }: { full?: boolean }) {
  return (
    <div className={clsx("flex items-center justify-center", full ? "h-screen" : "h-64")}>
      <motion.div className="h-10 w-10 rounded-full border-2 border-accent/20 border-t-accent"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-md bg-base-800/70", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="rounded-full bg-base-800 p-3 text-slate-500">{icon ?? <Inbox size={22} />}</div>
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {hint && <div className="max-w-sm text-xs text-slate-500">{hint}</div>}
    </motion.div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <AlertTriangle size={18} /> {error instanceof Error ? error.message : "Не удалось загрузить данные"}
    </div>
  );
}
