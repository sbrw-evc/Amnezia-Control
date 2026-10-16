# Amnezia Control

**English** · [Русский](README.ru.md)

A control panel for a self-hosted **AmneziaWG** server and selective routing of a home network through the VPN:
sites from a list go through the tunnel, everything else goes directly through your ISP.
It includes traffic accounting, a connection map, Akvorado-style network flow analytics (NetFlow → ClickHouse),
Telegram alerts, backups and secret storage in OpenBao.

![stack](https://img.shields.io/badge/backend-FastAPI-009688) ![stack](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![stack](https://img.shields.io/badge/db-PostgreSQL%2016-336791) ![stack](https://img.shields.io/badge/flows-ClickHouse-ffcc01)
![stack](https://img.shields.io/badge/secrets-OpenBao-5c4ee5) ![stack](https://img.shields.io/badge/VPN-AmneziaWG%203.x-orange)

## Features

- **VPN clients** — create clients with an access period, monthly quota, tags and owner; block manually or automatically
  (expiry, quota); reissue keys; bulk actions; CSV export.
- **Config delivery** — QR code and `.conf` for AmneziaWG, a `vpn://` key for Amnezia VPN, one-time links with an expiry.
- **VPN on MikroTik** — a WireGuard server on the home router managed alongside Amnezia: one-click setup, the same client
  lifecycle, quotas, traffic and configs; clients reach the home network, sites from the list go through Amnezia.
- **Monitoring** — live throughput (SSE), traffic per period, top clients, activity heatmap, countries.
- **Connection map** — OpenStreetMap (served through the panel's own caching tile proxy), DB-IP Lite geolocation.
- **Flow analytics** — NetFlow v9 from MikroTik into ClickHouse; overview, visualization (stacked / 100% / lines / grid / sankey),
  dimensions, top by average / peak / last, bidirectional mode, previous-period comparison, a filter language,
  saved filters, state in the URL.
- **Routing** — tunnel status on MikroTik, site list upload (`ip-list.json`), custom domains and prefixes,
  "where will this traffic go" check, automatic fallback to the ISP when the tunnel is down.
- **AWG server** — obfuscation parameters, an `awg0.conf` editor with backups that applies changes without dropping connections.
- **Security** — roles (administrator / operator / viewer), argon2, 2FA (TOTP), revocable sessions,
  API tokens, audit log, secrets kept only in OpenBao.
- **Notifications** — toast notifications (up to 5 at once) for every event in the app and a notification center with history.
- **Operations** — alerts (VPS, gateway, tunnel, OpenBao, quotas, expiry) with Telegram notifications,
  daily backups (PostgreSQL + OpenBao snapshot), several API processes with leader election.

## Architecture

```
 LAN ──► MikroTik ──(dst ∈ vpn-sites)──► gateway (Docker host) ──awg0──► Amnezia server (VPS)
            │  └─(everything else)──► ISP
            └─ NetFlow v9 ──► flow-collector ──► ClickHouse
                                                     ▲
 browser ──► frontend (nginx) ──► backend (FastAPI ×N) ──► PostgreSQL · OpenBao · SSH (VPS, MikroTik)
```

| Service | Purpose |
|---|---|
| `awg-client` | The gateway's AmneziaWG client: policy routing LAN → `awg0`, NAT, MSS clamp |
| `backend` | REST API, SSE, background jobs (polling, policies, health checks, backups) |
| `frontend` | SPA + API proxy + OpenStreetMap tile proxy |
| `postgres` | Clients, statistics, audit, alerts, users |
| `openbao` / `bao-init` | Secrets (client keys, SSH key, TOTP, Telegram token), auto-unseal |
| `clickhouse` | Network flows, site dictionary (`ip_trie`) |
| `flow-collector` | goflow2 + enrichment (country, ASN, direction, route) |

See the [Wiki](https://github.com/sbrw-evc/Amnezia-Control/wiki) for details.

## Quick start

Requirements: Docker 24+ with Compose v2, SSH key access to the Amnezia VPS and to MikroTik (RouterOS 7).

```bash
git clone https://github.com/sbrw-evc/Amnezia-Control.git /opt/amnezia-control
cd /opt/amnezia-control
./install.sh              # creates .env with random passwords
nano .env                 # AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR, PUBLIC_BASE_URL
./install.sh              # starts the stack
```

Panel: `http://<GATEWAY_IP>:8080`, login `admin`, password — `INITIAL_ADMIN_PASSWORD` from `.env`
(you will be asked to change it on first login). Then:

1. Create a client for the gateway in the panel, save its config as `awg-client/config/awg0.conf`, restart `awg-client`.
2. Import `mikrotik/amnezia-control.rsc` on MikroTik (addresses are at the top of the file).
3. Upload the site list in the "Routing" section.

Step by step — [Installation](https://github.com/sbrw-evc/Amnezia-Control/wiki/Installation).

## Docker images

Every release publishes images to GitHub Container Registry (tags `X.Y.Z`, `X.Y`, `latest`):

| Image | Platforms |
|---|---|
| `ghcr.io/sbrw-evc/amnezia-control-backend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-frontend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-flow-collector` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-awg-client` | linux/amd64 |

The version is set by `AC_VERSION` in `.env`; `install.sh` pulls the images, `docker compose up -d --build` builds them locally.
The release page also has `amnezia-control-X.Y.Z-deploy.tar.gz` — everything needed to run the stack without cloning the repository.

## Development

```bash
cd frontend && npm install && VITE_API_TARGET=http://<host>:8080 npm run dev
```

Structure, principles and API — see [Wiki → Development](https://github.com/sbrw-evc/Amnezia-Control/wiki/Development).
Interactive API documentation is available at `/api/docs`.

## License

MIT
