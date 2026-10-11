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
| `ROUTER_SSH_USER` | `admin` | SSH user on MikroTik |
| `GATEWAY_IP` | `192.168.0.210` | LAN address of the gateway (the Docker host) |
| `LAN_CIDR` | `192.168.0.0/24` | Local network (used to classify flows) |
| `LAN_IF` | `eth0` | LAN interface of the gateway host |
| `TUNNEL_NET` | `10.8.1.0/24` | AmneziaWG tunnel network |
| `SSH_KEY_FILE` | `/root/.ssh/id_ed25519` | SSH key imported into OpenBao on first start |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Panel URL (used in config share links) |
| `PANEL_PORT` | `8080` | Panel port |
| `FLOW_PORT` | `2055` | UDP port for NetFlow |
| `INITIAL_ADMIN_USER` / `INITIAL_ADMIN_PASSWORD` | `admin` / — | First administrator (created when there are no users); the password is valid only until the first login |
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
| Monitoring | Server polling interval | 10 s by default |
| | Statistics retention | 90 days by default |
| | "Gateway silent" threshold | Minutes without a handshake before an alert |
| | Report time zone | For the heatmap and messages |
| Notifications | Enable, minimum severity, Telegram chat id | See [[Monitoring]] |
| Backups | Daily backup, number of backups kept | See [[Backups]] |

Settings are stored in PostgreSQL and picked up by all processes within 15 seconds.
