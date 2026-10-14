import type { DeviceAction, NetworkDevice } from "./types";

export const ROLE_LABEL: Record<string, string> = {
  router: "Маршрутизатор", switch: "Коммутатор", firewall: "Межсетевой экран", ap: "Точка доступа",
  controller: "Контроллер", server: "Сервер", gateway: "Шлюз", other: "Другое",
};
export const SEGMENT_LABEL: Record<string, string> = { home: "Дом", smb: "Малый бизнес", enterprise: "Корпоративный", any: "Универсальный" };
export const SOURCE_LABEL: Record<string, string> = { arp: "ARP", dhcp: "DHCP", wifi: "Wi-Fi", bridge: "порт коммутатора", controller: "контроллер" };
export const TRANSPORT_LABEL: Record<string, string> = { api: "REST API (HTTPS)", https: "HTTPS API", http: "HTTP API", ssh: "SSH", snmp: "SNMP" };
export const STATUS: Record<NetworkDevice["status"], { label: string; tone: "green" | "red" | "amber" | "slate" }> = {
  up: { label: "в сети", tone: "green" }, down: { label: "недоступно", tone: "red" }, error: { label: "ошибка опроса", tone: "amber" },
  unknown: { label: "не опрашивалось", tone: "slate" },
};
export const ACTION_LABEL: Record<DeviceAction, string> = {
  hostname: "Имя устройства", interface: "Интерфейсы", dns: "DNS-серверы", ntp: "NTP-серверы", flow_export: "Экспорт потоков",
  reboot: "Перезагрузка", endpoint_block: "Блокировка клиентов", command: "Консоль CLI", backup: "Резервная копия конфигурации",
};
export const CRED_LABEL: Record<string, string> = {
  username: "Пользователь", password: "Пароль", private_key: "Приватный SSH-ключ", enable_password: "Пароль enable",
  api_key: "API key / Client ID / токен", api_secret: "API secret / Client Secret", snmp_version: "Версия SNMP",
  snmp_community: "SNMP community", snmp_user: "SNMPv3 пользователь", snmp_auth_protocol: "SNMPv3 auth",
  snmp_auth_password: "SNMPv3 auth-пароль", snmp_priv_protocol: "SNMPv3 priv", snmp_priv_password: "SNMPv3 priv-пароль",
};
export const SECRET_FIELDS = new Set(["password", "private_key", "enable_password", "api_key", "api_secret", "snmp_community",
  "snmp_auth_password", "snmp_priv_password"]);

export function bps(v: number | null | undefined): string {
  if (!v) return "0 бит/с";
  const u = ["бит/с", "Кбит/с", "Мбит/с", "Гбит/с", "Тбит/с"];
  let i = 0;
  let x = v;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function uptime(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} дн ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}

export function speed(mbps: number | null | undefined): string {
  if (!mbps) return "—";
  return mbps >= 1000 ? `${mbps / 1000} Гбит/с` : `${mbps} Мбит/с`;
}
