import { k, locale, t } from "@/i18n";

export class Fmt {
  private static readonly units = ["B", "KB", "MB", "GB", "TB", "PB"];

  static bytes(n: number | null | undefined, digits = 1): string {
    if (!n) return "0 B";
    let i = 0;
    let v = n;
    while (v >= 1024 && i < Fmt.units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i ? digits : 0)} ${Fmt.units[i]}`;
  }

  static rate(bytesPerSec: number | null | undefined): string {
    if (!bytesPerSec) return "0 bit/s";
    const bits = bytesPerSec * 8;
    const u = ["bit/s", "Kbit/s", "Mbit/s", "Gbit/s"];
    let i = 0;
    let v = bits;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  static ago(iso: string | null | undefined): string {
    if (!iso) return t("never");
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 0) return t("just now");
    if (s < 60) return t("{n} s ago", { n: Math.round(s) });
    if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
    if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
    if (s < 86400 * 30) return t("{n} d ago", { n: Math.round(s / 86400) });
    return Fmt.date(iso);
  }

  static until(iso: string | null | undefined): string {
    if (!iso) return t("no limit");
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (s <= 0) return t("expired");
    if (s < 3600) return t("{n} min", { n: Math.ceil(s / 60) });
    if (s < 86400) return t("{n} h", { n: Math.ceil(s / 3600) });
    return t("{n} d", { n: Math.ceil(s / 86400) });
  }

  static date(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" }) : "—";
  }

  static dateTime(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  }

  static flag(code: string | null | undefined): string {
    if (!code || code.length !== 2) return "🌐";
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }

  static num(n: number): string {
    return n.toLocaleString(locale());
  }
}

/** English keys: draw them with t(). */
export const ROLE_LABEL: Record<string, string> = { admin: k("Administrator"), operator: k("Operator"), viewer: k("Viewer") };
export const STATUS_LABEL: Record<string, string> = { active: k("Active"), blocked: k("Blocked"), missing: k("Removed on the server") };
export const REASON_LABEL: Record<string, string> = { manual: k("manually"), expired: k("expired"), quota: k("quota") };
