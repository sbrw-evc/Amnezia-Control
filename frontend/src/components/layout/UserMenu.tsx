import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, ExternalLink, Languages, LogOut, Moon, ShieldCheck, Sun, UserCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { LANGS, setLang, t, useLang } from "@/i18n";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { useAuth } from "@/store/auth";

const COLORS = ["#65a30d", "#ca8a04", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a"];
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

export function initialsOf(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Initials on a colour picked from the name, as Umbrella's avatar without a photo. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: COLORS[h % COLORS.length] }}>
      {initialsOf(name)}
    </span>
  );
}

type Option = { key: string; label: string; icon?: ReactNode; selected: boolean; select: () => void };

function Accordion({ icon, label, value, open, onToggle, options }: { icon: ReactNode; label: string; value: string; open: boolean; onToggle: () => void; options: Option[] }) {
  const panel = useId();
  return (
    <div>
      <button type="button" className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-slate-200 hover:bg-base-850" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <span className="text-slate-500">{value}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={spring} className="inline-flex text-slate-500"><ChevronRight size={15} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={panel} role="group" aria-label={label} className="overflow-hidden pl-8"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            {options.map((o) => (
              <button key={o.key} type="button" role="menuitemradio" aria-checked={o.selected} onClick={o.select}
                className={clsx("flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-sm hover:bg-base-850", o.selected ? "font-semibold text-accent" : "text-slate-300")}>
                {o.icon}
                <span className="flex-1 text-left">{o.label}</span>
                {o.selected && <Check size={15} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The user menu of the top bar (Umbrella UserMenu): profile, account and security in SPA, language, theme, sign out. */
export default function UserMenu() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const lang = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"language" | "theme" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = user?.display_name || user?.username || "?";
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api.auth.config(), staleTime: 300_000 });
  const account = config.data?.account_url;

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    setSection(null);
    const down = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const origin = () => {
    const r = trigger.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
  };

  return (
    <div className="relative" ref={root}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("Account menu")} onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition hover:bg-base-900/70">
        <Avatar name={name} />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[160px] truncate text-sm font-semibold text-slate-100">{name}</span>
          <span className="block text-[12px] text-slate-500">{t(ROLE_LABEL[user?.role ?? "viewer"])}</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="hidden text-slate-500 sm:inline-flex"><ChevronDown size={16} /></motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} style={{ transformOrigin: "top right" }}
            className="card absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] p-2">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={name} size={44} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-100">{name}</div>
                <div className="truncate text-[12.5px] text-slate-500">{user?.username} · {t(ROLE_LABEL[user?.role ?? "viewer"])}</div>
              </div>
            </div>
            <div className="my-1 h-px bg-base-700" />
            <button type="button" role="menuitem" onClick={() => navigate("/profile")} className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-slate-200 hover:bg-base-850">
              <UserCircle size={17} /> {t("Profile")}
            </button>
            {account && (
              <a role="menuitem" href={account} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-slate-200 hover:bg-base-850">
                <ShieldCheck size={17} /> <span className="flex-1">{t("Account and security")}</span> <ExternalLink size={14} className="text-slate-500" />
              </a>
            )}
            <Accordion icon={<Languages size={17} />} label={t("Language")} value={LANGS.find((l) => l.code === lang)?.label ?? lang}
              open={section === "language"} onToggle={() => setSection(section === "language" ? null : "language")}
              options={LANGS.map((l) => ({ key: l.code, label: l.label, selected: l.code === lang, select: () => setLang(l.code) }))} />
            <Accordion icon={theme === "dark" ? <Moon size={17} /> : <Sun size={17} />} label={t("Theme")} value={t(theme === "dark" ? "Dark" : "Light")}
              open={section === "theme"} onToggle={() => setSection(section === "theme" ? null : "theme")}
              options={(["light", "dark"] as Theme[]).map((v) => ({
                key: v, label: t(v === "dark" ? "Dark" : "Light"), icon: v === "dark" ? <Moon size={15} /> : <Sun size={15} />,
                selected: v === theme, select: () => setTheme(v, origin()),
              }))} />
            <div className="my-1 h-px bg-base-700" />
            <button type="button" role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
              <LogOut size={17} /> {t("Sign out")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
