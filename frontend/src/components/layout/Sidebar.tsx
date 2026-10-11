import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity, Archive, BarChart3, Waypoints, Bell, ChevronsLeft, FileClock, Globe2, LayoutDashboard, LogOut, Network, Server,
  Settings, Shield, Users, UserCog,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { live, useLive } from "@/lib/live";
import { ROLE_LABEL } from "@/lib/format";
import { useAuth } from "@/store/auth";
import type { Role } from "@/lib/types";
import { StatusDot } from "@/components/ui/Primitives";
import { NotificationBell } from "./NotificationCenter";

interface Item { to: string; label: string; icon: ReactNode; role?: Role; badge?: number }

function useAlertCount() {
  const q = useQuery({ queryKey: ["summary"], queryFn: () => api.analytics.summary(), refetchInterval: 30_000 });
  useLive("alert", () => q.refetch(), []);
  const a = q.data?.alerts ?? {};
  return { total: (a.critical ?? 0) + (a.warning ?? 0) + (a.info ?? 0), critical: a.critical ?? 0 };
}

export default function Sidebar({ collapsed, onToggle, onNavigate, onNotifications }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void; onNotifications: () => void }) {
  const { user, can, logout } = useAuth();
  const alerts = useAlertCount();
  const [connected, setConnected] = useState(true);
  useEffect(() => live.onStatus(setConnected), []);

  const sections: { title: string; items: Item[] }[] = [
    { title: "Мониторинг", items: [
      { to: "/", label: "Обзор", icon: <LayoutDashboard size={18} /> },
      { to: "/analytics", label: "Аналитика", icon: <BarChart3 size={18} /> },
      { to: "/flows", label: "Анализ потоков", icon: <Waypoints size={18} /> },
      { to: "/map", label: "Карта подключений", icon: <Globe2 size={18} /> },
      { to: "/alerts", label: "Алерты", icon: <Bell size={18} />, badge: alerts.total },
    ] },
    { title: "Управление", items: [
      { to: "/clients", label: "Клиенты VPN", icon: <Users size={18} /> },
      { to: "/routing", label: "Маршрутизация", icon: <Network size={18} /> },
    ] },
    { title: "Система", items: [
      { to: "/server", label: "Сервер AWG", icon: <Server size={18} />, role: "admin" },
      { to: "/users", label: "Доступ к панели", icon: <UserCog size={18} />, role: "admin" },
      { to: "/audit", label: "Журнал аудита", icon: <FileClock size={18} />, role: "admin" },
      { to: "/backups", label: "Резервные копии", icon: <Archive size={18} />, role: "admin" },
      { to: "/settings", label: "Настройки", icon: <Settings size={18} /> },
    ] },
  ];

  return (
    <motion.aside animate={{ width: collapsed ? 72 : 248 }} transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="flex h-full flex-col border-r border-base-700/70 bg-base-900/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4">
        <motion.div whileHover={{ rotate: 12, scale: 1.05 }} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-glow">
          <Activity size={18} className="text-white" />
        </motion.div>
        {!collapsed && (
          <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="min-w-0">
            <div className="flex items-center gap-2 font-semibold leading-tight text-white">Amnezia Control</div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">VPN control center <span className="rounded bg-orange-500/90 px-1 text-[9px] font-bold uppercase text-white">AWG</span></div>
          </motion.div>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sections.map((s) => {
          const items = s.items.filter((i) => !i.role || can(i.role));
          if (!items.length) return null;
          return (
            <div key={s.title}>
              {!collapsed && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">{s.title}</div>}
              <div className="space-y-0.5">
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={onNavigate} title={collapsed ? i.label : undefined}
                    className={({ isActive }) => clsx("group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                      isActive ? "text-white" : "text-slate-400 hover:bg-base-800/70 hover:text-slate-100")}>
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-accent/40 bg-accent/15"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                        {isActive && <motion.span layoutId="nav-bar" className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-1 rounded-r bg-accent" />}
                        <span className="relative">{i.icon}</span>
                        {!collapsed && <span className="relative flex-1 truncate">{i.label}</span>}
                        {!!i.badge && (
                          <motion.span key={i.badge} initial={{ scale: 0.5 }} animate={{ scale: 1 }}
                            className={clsx("relative rounded-full px-1.5 text-[10px] font-bold text-white",
                              alerts.critical ? "bg-red-500" : "bg-amber-500", collapsed && "absolute right-1 top-1")}>
                            {i.badge}
                          </motion.span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-base-700/70 p-3">
        <NavLink to="/profile" onClick={onNavigate} className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-base-800">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-base-700 text-sm font-semibold text-white">
            {(user?.display_name || user?.username || "?").slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-100">{user?.display_name || user?.username}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Shield size={10} /> {ROLE_LABEL[user?.role ?? "viewer"]}
              </div>
            </div>
          )}
        </NavLink>
        <div className={clsx("flex items-center gap-2", collapsed ? "flex-col" : "justify-between")}>
          <span className="flex items-center gap-2 px-2 text-[11px] text-slate-500" title={connected ? "Live-поток подключён" : "Переподключение…"}>
            <StatusDot on={connected} warn={!connected} /> {!collapsed && (connected ? "Live" : "Офлайн")}
          </span>
          <div className={clsx("flex gap-1", collapsed && "flex-col items-center")}>
            <NotificationBell collapsed={collapsed} onOpen={onNotifications} />
            <button onClick={onToggle} className="hidden rounded-md p-1.5 text-slate-400 hover:bg-base-800 hover:text-white lg:block" title="Свернуть">
              <motion.span animate={{ rotate: collapsed ? 180 : 0 }} className="block"><ChevronsLeft size={16} /></motion.span>
            </button>
            <button onClick={logout} className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" title="Выйти"><LogOut size={16} /></button>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
