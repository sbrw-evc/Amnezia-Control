import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useAuth } from "@/store/auth";
import { t } from "@/i18n";
import { NAV, pageOf } from "./nav";

const OPEN_KEY = "network-control.sidebar.groups";
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

function useAlertCount() {
  const q = useQuery({ queryKey: ["summary"], queryFn: () => api.analytics.summary(), refetchInterval: 30_000 });
  useLive("alert", () => q.refetch(), []);
  const a = q.data?.alerts ?? {};
  return { total: (a.critical ?? 0) + (a.warning ?? 0) + (a.info ?? 0), critical: a.critical ?? 0 };
}

function savedGroups(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    return Array.isArray(v) ? v : NAV.map((g) => g.id);
  } catch {
    return NAV.map((g) => g.id);
  }
}

/**
 * The sidebar of the Umbrella shell: groups are accordions with an icon and a chevron, the current page is marked by
 * a pill that slides between links; collapsed, it is a rail of icons with tooltips.
 */
export default function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const can = useAuth((s) => s.can);
  const alerts = useAlertCount();
  const location = useLocation();
  const [open, setOpen] = useState<string[]>(savedGroups);
  const current = pageOf(location.pathname)?.to;

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* not remembered */
    }
  }, [open]);
  // The group of the current page opens by itself.
  useEffect(() => {
    const g = NAV.find((x) => x.pages.some((p) => p.to === current));
    if (g && !open.includes(g.id)) setOpen((o) => [...o, g.id]);
  }, [current]);

  return (
    <nav aria-label={t("Main menu")} className={clsx("flex h-full flex-col overflow-y-auto px-2.5 pb-4", collapsed ? "w-[64px]" : "w-[260px]")}>
      {NAV.map((g) => {
        const pages = g.pages.filter((p) => !p.role || can(p.role));
        if (!pages.length) return null;
        const isOpen = collapsed || open.includes(g.id);
        const Icon = g.icon;
        return (
          <div key={g.id} className="mb-1">
            {!collapsed && (
              <button type="button" aria-expanded={isOpen}
                onClick={() => setOpen((o) => (o.includes(g.id) ? o.filter((x) => x !== g.id) : [...o, g.id]))}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] font-semibold text-slate-400 transition hover:bg-base-900/70 hover:text-slate-100">
                <Icon size={17} />
                <span className="flex-1 text-left">{t(g.title)}</span>
                <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={spring} className="inline-flex"><ChevronRight size={15} /></motion.span>
              </button>
            )}
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className={clsx("overflow-hidden", !collapsed && "pl-2")}>
                  {pages.map((p) => {
                    const PIcon = p.icon;
                    const active = p.to === current;
                    const badge = p.badge === "alerts" ? alerts.total : 0;
                    return (
                      <NavLink key={p.to} to={p.to} end={p.to === "/"} onClick={onNavigate} title={collapsed ? t(p.label) : undefined}
                        aria-current={active ? "page" : undefined}
                        className={clsx("relative mt-0.5 flex items-center gap-3 rounded-control px-2.5 py-2 text-sm transition",
                          active ? "font-semibold text-accent" : "text-slate-300 hover:bg-base-900/70 hover:text-slate-100",
                          collapsed && "justify-center")}>
                        {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-control bg-accent-soft" transition={spring} />}
                        <PIcon size={17} className="relative shrink-0" />
                        {!collapsed && <span className="relative flex-1 truncate">{t(p.label)}</span>}
                        {!!badge && (
                          <span className={clsx("relative rounded-full px-1.5 text-[11px] font-bold leading-[18px] text-white",
                            alerts.critical ? "bg-red-600" : "bg-amber-500", collapsed && "absolute right-0.5 top-0.5 px-1 text-[9px] leading-[14px]")}>
                            {badge}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </nav>
  );
}
