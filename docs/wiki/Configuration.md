# Configuration

## Environment variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `AWG_HOST` | — | IP or hostname of the Amnezia server (VPS). Required. |
| `AWG_SSH_USER` | `root` | SSH user on the VPS |
| `AWG_CONTAINER` | `amnezia-awg2` | AmneziaWG Docker container on the VPS |
| `AWG_IFACE` | `awg0` | Interface inside the container |
| `AWG_BIN` | `awg` | CLI tool (`awg` or `wg`) |
| `AWG_DIR` | `/opt/amnezia/awg` | Config directory inside the container |
| `ROUTER_HOST` | `192.168.0.1` | MikroTik address |
| `KEEP_INTERNAL` | `1` | Collector: keep flows between two local addresses (`Direction = internal`) |
| `ROUTER_SSH_USER` | `admin` | SSH user on MikroTik |
| `GATEWAY_IP` | `192.168.0.210` | LAN address of the gateway (the Docker host) |
| `LAN_CIDR` | `192.168.0.0/24` | Local networks for classifying flows, comma-separated; IPv6 prefixes are allowed (`192.168.0.0/24,2001:db8:10::/64`) |
| `LAN_IF` | `eth0` | LAN interface of the gateway host |
| `TUNNEL_NET` | `10.8.1.0/24` | AmneziaWG tunnel network |
| `MT_WG_IFACE` | `wg-nc` | WireGuard interface on MikroTik (see [[MikroTik-VPN]]) |
| `MT_WG_NETWORK` | `10.9.0.0/24` | Network of MikroTik VPN clients; the first address belongs to the router |
| `MT_WG_PORT` | `51820` | UDP port of the MikroTik WireGuard server |
| `PORT_FORWARDS` | — | TCP ports of the gateway forwarded into the tunnel, `local=ip:port` separated by spaces, e.g. `3128=10.8.1.0:3128` for the GitHub proxy (see [[Troubleshooting]]) |
| `SSH_KEY_FILE` | `/root/.ssh/id_ed25519` | SSH key imported into OpenBao on first start |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Panel URL (used in config share links) |
| `PANEL_PORT` | `8080` | Panel port |
| `FLOW_PORT` | `2055` | UDP port for NetFlow |
| `SFLOW_PORT` | `6343` | UDP port for sFlow |
| `SPA_CONNECTION_KEY` | — | Connection key `spa1.…` issued by SPA (see below) |
| `SPA_CONNECTION_KEY_FILE` | — | A file holding the connection key, instead of the variable |
| `SPA_PUBLIC_URL` | — | Address of the panel when it differs from the request address (for the redirect address) |
| `POSTGRES_PASSWORD` | — | PostgreSQL password |
| `CLICKHOUSE_PASSWORD` | — | ClickHouse password |
| `OPENBAO_VERSION` | `2.6.2` | OpenBao image version |
| `CLICKHOUSE_VERSION` | `24.8` | ClickHouse image version |
| `FLOWS_TTL_DAYS` | `30` | Flow retention |
| `WEB_CONCURRENCY` | `2` | Number of API processes |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `COOKIE_SECURE` | `false` | Set to `true` when the panel is served over HTTPS |

## In-panel settings ("Settings" page)

| Group | Setting | Description |
|---|---|---|
| Client configs | DNS for clients | `DNS` value in issued configs |
| | Server address in configs | Empty — `AWG_HOST` |
| | Share link lifetime | For one-time config links |
| Defaults | Default quota and access period | Pre-filled in the new client form |
| | Quota warning threshold, days before expiry | For alerts |
| VPN on MikroTik | Connection address, DNS, AllowedIPs | Set on the "VPN on MikroTik" page, see [[MikroTik-VPN]] |
| Monitoring | Server polling interval | 10 s by default |
| | Statistics retention | 90 days by default |
| | "Gateway silent" threshold | Minutes without a handshake before an alert |
| | Report time zone | For the heatmap and messages |
| Notifications | Enable, minimum severity, Telegram chat id | See [[Monitoring]] |
| Backups | Daily backup, number of backups kept | See [[Backups]] |
| Network and devices | Client offline after, forget inactive clients after | 15 minutes, 90 days |
| | Collector address and port for flow export | Empty — `GATEWAY_IP`, port 2055; used by the **Flow export** action of devices |
| Traffic analysis | Threat lists, refresh interval, networks never flagged | See [[Flows]] |
| | Reverse DNS (PTR) of remote hosts | On by default |

Settings are stored in PostgreSQL and picked up by all processes within 15 seconds.

## Connecting to SPA

Sign-in and access are managed in **SPA — Single Point of Authorization** ([repository](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-),
[protocol](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-/blob/main/docs/protocol.md)). Without a connection the panel shows "This application is not connected to SPA".

1. In SPA: **Applications → Connect an application**, type `network-control`, the address of the panel
   (`PUBLIC_BASE_URL`). The redirect address is `<address>/api/auth/spa/callback`, the address after sign-out `<address>/`.
2. Assign the roles `admin`, `operator`, `viewer` to people or groups. The first administrator of the panel is whoever
   SPA gives the `admin` role. **Give it to yourself before step 3:** the first synchronization disables every local
   user SPA does not list, the old local `admin` included (a local user whose user name SPA also has is kept and bound
   to that SPA account), and revokes their sessions and API tokens.
3. Put the connection key into `SPA_CONNECTION_KEY` in `.env` (or a file named by `SPA_CONNECTION_KEY_FILE`, or the
   OpenBao secret `amnezia/spa/connection_key`, field `value` — re-read every minute) and run `docker compose up -d backend`.

The first successful synchronization also deletes the TOTP secrets of the old sign-in (`users/<id>/totp` in OpenBao;
audit log: `spa.legacy_totp_purged`).

The users page and **Settings** show the connection: issuer, application, last synchronisation, counts, errors and
**Synchronize now**.
