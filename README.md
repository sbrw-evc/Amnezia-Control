# Network Control

**English** · [Русский](README.ru.md)

A control panel for a home or corporate network: **network devices** of 25+ platforms with settings from the panel,
a **live network map** down to every phone and TV, **flow analytics** (NetFlow / IPFIX / sFlow → ClickHouse) with
detection rules and threat intelligence — together with a self-hosted **AmneziaWG** VPN and selective routing
(sites from a list go through the tunnel, everything else goes directly through your ISP), Telegram alerts, backups
and secret storage in OpenBao.

![stack](https://img.shields.io/badge/backend-FastAPI-009688) ![stack](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![stack](https://img.shields.io/badge/db-PostgreSQL%2016-336791) ![stack](https://img.shields.io/badge/flows-ClickHouse-ffcc01)
![stack](https://img.shields.io/badge/secrets-OpenBao-5c4ee5) ![stack](https://img.shields.io/badge/VPN-AmneziaWG%203.x-orange)

## Screenshots

The overview with the **First steps** checklist, in the light and the dark theme:

| Light | Dark |
|---|---|
| <img src="docs/screens/overview-light.png" alt="Overview, light theme"> | <img src="docs/screens/overview-dark.png" alt="Overview, dark theme"> |

The other pages follow the theme of your GitHub (both versions are in [`docs/screens`](docs/screens)):

| | |
|---|---|
| **Network devices**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/devices-dark.png"><img src="docs/screens/devices-light.png" alt="Network devices"></picture> | **Network map**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/network-map-dark.png"><img src="docs/screens/network-map-light.png" alt="Network map"></picture> |
| **Flow analysis**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/flows-dark.png"><img src="docs/screens/flows-light.png" alt="Flow analysis"></picture> | **VPN clients**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/vpn-clients-dark.png"><img src="docs/screens/vpn-clients-light.png" alt="VPN clients"></picture> |
| **Sign-in through SPA**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/sign-in-dark.png"><img src="docs/screens/sign-in-light.png" alt="Sign-in through SPA"></picture> | |

The screenshots are taken from the real application with demo data: `./scripts/screenshots.sh` (see [Development](#development)).

## Features

- **Network devices** — MikroTik, TP-Link / Omada, UniFi, Keenetic, OpenWrt, OPNsense, pfSense, Cisco, HP / Aruba, Dell,
  Zyxel, Juniper, Huawei, FortiGate, Eltex, Redfish servers and any SNMP device: add, remove, poll facts, interfaces
  with live rates, LLDP / CDP / MNDP neighbours and clients; change name, interfaces, DNS, NTP, flow export, reboot,
  CLI console and configuration backups from the panel; subnet discovery with platform detection.
- **Network clients** — every phone, laptop, TV and camera merged from ARP, DHCP, Wi-Fi, controllers and switch ports,
  with vendor by MAC, names and blocking on the controller.
- **Network map** — a live graph built from the devices' data: links with utilisation, controllers and their APs,
  clients by port and Wi-Fi, traffic per client, discovered neighbours, Internet and VPN.
- **VPN clients** — create clients with an access period, monthly quota, tags and owner; block manually or automatically
  (expiry, quota); reissue keys; bulk actions; CSV export.
- **Config delivery** — QR code and `.conf` for AmneziaWG, a `vpn://` key for Amnezia VPN, one-time links with an expiry.
- **VPN on MikroTik** — a WireGuard server on the home router managed alongside Amnezia: one-click setup, the same client
  lifecycle, quotas, traffic and configs; clients reach the home network, sites from the list go through Amnezia.
- **Monitoring** — live throughput (SSE), traffic per period, top clients, activity heatmap, countries.
- **Connection map** — OpenStreetMap (served through the panel's own caching tile proxy), DB-IP Lite geolocation.
- **Flow analytics** — NetFlow v5 / v9, IPFIX and sFlow from any device into ClickHouse with 5-minute and hourly
  aggregates (up to 2 years); exporters and interfaces, applications, client names, reverse DNS; visualization
  (stacked / 100% / lines / grid / sankey), top by average / peak / last, bidirectional mode, previous-period
  comparison, a filter language, saved filters and views, state in the URL.
- **Detection rules and threats** — thresholds, volumetric and SYN DDoS, port / host scans, weekly-baseline anomalies
  and drops, silent exporters, link utilisation, contacts with FireHOL / Spamhaus / abuse.ch blocklists → alerts with
  a link to the traffic.
- **Routing** — tunnel status on MikroTik, site list upload (`ip-list.json`), custom domains and prefixes,
  "where will this traffic go" check, automatic fallback to the ISP when the tunnel is down.
- **AWG server** — obfuscation parameters, an `awg0.conf` editor with backups that applies changes without dropping connections.
- **Security** — sign-in and access managed in [SPA — Single Point of Authorization](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-) (passwords, passkeys, MFA,
  directories live there), roles (administrator / operator / viewer) assigned in SPA, revocable sessions,
  API tokens, audit log, secrets kept only in OpenBao.
- **First steps and setup guides** — the overview shows a checklist from installation to a working panel (SPA
  connection, application address, first device, flow intake, VPN client, Telegram notifications, backups), and the
  devices, flow analysis, VPN clients, routing and settings pages have step-by-step guides; every step is checked
  against real data and ticks itself off when done.
- **Notifications** — toast notifications (up to 5 at once) for every event in the app and a notification center with history.
- **Operations** — alerts (VPS, gateway, tunnel, OpenBao, quotas, expiry) with Telegram notifications,
  daily backups (PostgreSQL + OpenBao snapshot), several API processes with leader election.

## Architecture

```
 LAN ──► MikroTik ──(dst ∈ vpn-sites)──► gateway (Docker host) ──awg0──► Amnezia server (VPS)
            │  └─(everything else)──► ISP
 routers, switches, firewalls ── NetFlow / IPFIX / sFlow ──► flow-collector ──► ClickHouse
            ▲ REST / RCI / SSH CLI / SNMP                                         ▲
 browser ──► frontend (nginx) ──► backend (FastAPI ×N) ──► PostgreSQL · OpenBao · SSH (VPS)
```

| Service | Purpose |
|---|---|
| `awg-client` | The gateway's AmneziaWG client: policy routing LAN → `awg0`, NAT, MSS clamp |
| `backend` | REST API, SSE, device drivers, background jobs (VPN and device polling, policies, detection rules, health checks, backups) |
| `frontend` | Web UI (React) + API proxy + OpenStreetMap tile proxy |
| `postgres` | Clients, statistics, audit, alerts, users |
| `openbao` / `bao-init` | Secrets (client keys, SSH key, Telegram token, optionally the SPA connection key), auto-unseal |
| `clickhouse` | Network flows and aggregates; site, threat, exporter, interface and host dictionaries |
| `flow-collector` | goflow2 (NetFlow / IPFIX UDP 2055, sFlow UDP 6343) + enrichment (country, ASN, direction, route, exporter) |

See the [Wiki](https://github.com/sbrw-evc/Network-Control/wiki) for details.

## Supported devices

| Segment | Platforms |
|---|---|
| Home | MikroTik, Keenetic, OpenWrt (GL.iNet, Turris, Cudy…), TP-Link Archer / Deco (SNMP), ASUS Merlin, Synology (SSH / SNMP) |
| SMB | TP-Link Omada controller and JetStream switches, Ubiquiti UniFi and EdgeRouter / VyOS, OPNsense, pfSense, Zyxel, Dell PowerSwitch N, Netgear, D-Link |
| Enterprise | Cisco IOS / IOS-XE / NX-OS and Meraki, HP ProCurve / HPE Aruba (ArubaOS-Switch, AOS-CX), HPE Comware / H3C, Dell OS10, Juniper Junos, Huawei VRP, Fortinet FortiGate, Eltex, servers via Redfish (iDRAC, iLO, XCC, Supermicro) |
| Anything else | SNMP v1 / v2c / v3 with standard MIBs |

What each platform collects and allows to change: [Wiki → Network devices](https://github.com/sbrw-evc/Network-Control/wiki/Devices).

## Quick start

Requirements: Docker 24+ with Compose v2, SSH key access to the Amnezia VPS and to MikroTik (RouterOS 7).

```bash
git clone https://github.com/sbrw-evc/Network-Control.git /opt/network-control
cd /opt/network-control
./install.sh              # creates .env with random passwords
nano .env                 # AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR, PUBLIC_BASE_URL, SPA_CONNECTION_KEY
./install.sh              # starts the stack
```

### Sign-in and access are managed in SPA

Network Control has no passwords of its own: people sign in through
[SPA — Single Point of Authorization](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-) (OpenID Connect), which also decides their roles here
(`admin`, `operator`, `viewer`) and synchronises the users every 5 minutes. To connect, in SPA open
**Applications → Connect an application**, type `network-control`, address `PUBLIC_BASE_URL`, give people or groups
the roles, and put the connection key `spa1.…` into `SPA_CONNECTION_KEY` in `.env` — see the
[protocol](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-/blob/main/docs/protocol.md) and [Configuration](https://github.com/sbrw-evc/Network-Control/wiki/Configuration).

> [!IMPORTANT]
> **Give yourself the Administrator role in SPA before you connect.** The first synchronization disables every local
> user SPA does not list — including the old local `admin` — and revokes their sessions and API tokens. Without an
> administrator from SPA nobody can open the settings afterwards. An existing local user is kept (with its audit
> history) when SPA has a person with the same user name; from then on it is bound to that SPA account.

Moving from the panel's own sign-in (before 2.0): passwords and TOTP 2FA are gone — SPA does MFA now. The old TOTP
secrets in OpenBao (`users/<id>/totp`) are deleted at the first successful synchronization with SPA (recorded in the
audit log as `spa.legacy_totp_purged`); if OpenBao refuses, it is tried again at the next synchronization.

Panel: `http://<GATEWAY_IP>:8080` → **Sign in with SPA**. Then:

1. Create a client for the gateway in the panel, save its config as `awg-client/config/awg0.conf`, restart `awg-client`.
2. Import `mikrotik/network-control.rsc` on MikroTik (addresses are at the top of the file).
3. Upload the site list in the "Routing" section.

Step by step — [Installation](https://github.com/sbrw-evc/Network-Control/wiki/Installation).

## Docker images

Every release publishes images to GitHub Container Registry (tags `X.Y.Z`, `X.Y`, `latest`):

| Image | Platforms |
|---|---|
| `ghcr.io/sbrw-evc/network-control-backend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-frontend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-flow-collector` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-awg-client` | linux/amd64 |

The version is set by `NC_VERSION` in `.env`; `install.sh` pulls the images, `docker compose up -d --build` builds them locally.
The release page also has `network-control-X.Y.Z-deploy.tar.gz` — everything needed to run the stack without cloning the repository.

## Development

```bash
cd frontend && npm install && VITE_API_TARGET=http://<host>:8080 npm run dev
```

Demo data and screenshots: `backend/demo/run.py` starts the real backend against a PostgreSQL database that it empties
and fills with demo data; SPA, ClickHouse, OpenBao, the VPN server, the router and the device drivers are stand-ins
(an in-process OpenID Connect issuer, the embedded chdb, fakes with growing counters), and sign-in goes through the
real SPA flow as the demo administrator. `./scripts/screenshots.sh` builds the web app, starts the demo and takes
`docs/screens/*.png` with Playwright in both themes:

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
DEMO_DATABASE_URL=postgresql+asyncpg://user:pass@127.0.0.1:5432/nc_demo ./scripts/screenshots.sh
```

Structure, principles and API — see [Wiki → Development](https://github.com/sbrw-evc/Network-Control/wiki/Development).
Interactive API documentation is available at `/api/docs`.

## License

MIT
