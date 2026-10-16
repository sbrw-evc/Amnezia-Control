import { useSyncExternalStore } from "react";

/**
 * English and Russian, as in Umbrella Monitoring, Umbrella Flow and Inventory DB: English strings are the keys,
 * `src/i18n/ru/*.ts` map them to Russian (every file there is picked up). `{name}` placeholders are interpolated.
 * Messages of the server are English templates too; `tServer` translates them, placeholders included.
 */
export type Lang = "en" | "ru";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

const modules = import.meta.glob<Record<string, string>>("./ru/*.ts", { eager: true, import: "default" });
export const ru: Record<string, string> = Object.assign({}, ...Object.values(modules));

const KEY = "lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* storage is off */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let lang: Lang = initial();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => (lang === "ru" ? "ru-RU" : "en-GB");

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage is off */
  }
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

/** Translation in the current language (outside components and in event handlers). */
export function t(key: string, vars?: Record<string, string | number>): string {
  return fill(lang === "ru" ? (ru[key] ?? key) : key, vars);
}

/** Marks an English key that is translated later with t() (labels in constant maps, built before the language). */
export const k = (key: string) => key;

/** Plural forms: `tn(count, one, many)` with English one/many keys; Russian forms come from the dictionary as "one|few|many". */
export function tn(n: number, one: string, many: string): string {
  if (lang !== "ru") return fill(n === 1 ? one : many, { n });
  const forms = (ru[many] ?? ru[one] ?? many).split("|");
  if (forms.length < 3) return fill(forms[0], { n });
  const m10 = n % 10;
  const m100 = n % 100;
  const form = m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms[1] : forms[2];
  return fill(form, { n });
}

let patterns: { re: RegExp; names: string[]; ru: string }[] | null = null;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Translates a message of the server: an exact key, or a key template with {placeholders}. */
export function tServer(message: string): string {
  if (lang !== "ru" || !message) return message;
  if (ru[message]) return ru[message];
  if (!patterns)
    patterns = Object.entries(ru)
      .filter(([k]) => /\{\w+\}/.test(k))
      .map(([k, v]) => {
        const names: string[] = [];
        const re = new RegExp(
          "^" + k.split(/(\{\w+\})/).map((part) => {
            const m = /^\{(\w+)\}$/.exec(part);
            if (!m) return escape(part);
            names.push(m[1]);
            return "(.+?)";
          }).join("") + "$",
          "s",
        );
        return { re, names, ru: v };
      });
  for (const p of patterns) {
    const m = p.re.exec(message);
    if (m) return fill(p.ru, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
  }
  return message;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Current language; the component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => lang, () => lang);
}

/** `t` bound to the current language; the component re-renders when it changes. */
export function useT() {
  useLang();
  return t;
}
