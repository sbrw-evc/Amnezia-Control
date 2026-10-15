import { k, t } from "@/i18n";
import type { DeviceAction, NetworkDevice } from "./types";

// Labels hold English keys: render them with t(LABEL[x]).
export const ROLE_LABEL: Record<string, string> = {
  router: k("Router"), switch: k("Switch"), firewall: k("Firewall"), ap: k("Access point"),
  controller: k("Controller"), server: k("Server"), gateway: k("Gateway"), other: k("Other type"),
};
export const SEGMENT_LABEL: Record<string, string> = { home: k("Home"), smb: k("Small business"), enterprise: k("Enterprise"), any: k("Universal") };
export const SOURCE_LABEL: Record<string, string> = { arp: "ARP", dhcp: "DHCP", wifi: "Wi-Fi", bridge: k("switch port"), controller: k("controller") };
export const TRANSPORT_LABEL: Record<string, string> = { api: "REST API (HTTPS)", https: "HTTPS API", http: "HTTP API", ssh: "SSH", snmp: "SNMP" };
export const STATUS: Record<NetworkDevice["status"], { label: string; tone: "green" | "red" | "amber" | "slate" }> = {
  up: { label: k("online"), tone: "green" }, down: { label: k("unreachable"), tone: "red" }, error: { label: k("poll error"), tone: "amber" },
  unknown: { label: k("not polled"), tone: "slate" },
};
export const ACTION_LABEL: Record<DeviceAction, string> = {
  hostname: k("Device name"), interface: k("Interfaces"), dns: k("DNS servers"), ntp: k("NTP servers"), flow_export: k("Flow export"),
  reboot: k("Device reboot"), endpoint_block: k("Client blocking"), command: k("CLI console"), backup: k("Configuration backup"),
};
export const CRED_LABEL: Record<string, string> = {
  username: k("Username"), password: k("Password"), private_key: k("SSH private key"), enable_password: k("Enable password"),
  api_key: k("API key / Client ID / token"), api_secret: "API secret / Client Secret", snmp_version: k("SNMP version"),
  snmp_community: "SNMP community", snmp_user: k("SNMPv3 user"), snmp_auth_protocol: "SNMPv3 auth",
  snmp_auth_password: k("SNMPv3 auth password"), snmp_priv_protocol: "SNMPv3 priv", snmp_priv_password: k("SNMPv3 priv password"),
};
export const SECRET_FIELDS = new Set(["password", "private_key", "enable_password", "api_key", "api_secret", "snmp_community",
  "snmp_auth_password", "snmp_priv_password"]);

const RATE_UNITS = [k("bit/s"), k("Kbit/s"), k("Mbit/s"), k("Gbit/s"), k("Tbit/s")];

export function bps(v: number | null | undefined): string {
  if (!v) return `0 ${t("bit/s")}`;
  let i = 0;
  let x = v;
  while (x >= 1000 && i < RATE_UNITS.length - 1) { x /= 1000; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${t(RATE_UNITS[i])}`;
}

export function uptime(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${t("{n} d", { n: d })} ${t("{n} h", { n: h })}` : h ? `${t("{n} h", { n: h })} ${t("{n} min", { n: m })}` : t("{n} min", { n: m });
}

export function speed(mbps: number | null | undefined): string {
  if (!mbps) return "—";
  return mbps >= 1000 ? `${mbps / 1000} ${t("Gbit/s")}` : `${mbps} ${t("Mbit/s")}`;
}
