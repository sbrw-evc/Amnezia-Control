# Amnezia Control

**English** · [[Русский|ru-Home]]

**Amnezia Control** is a control panel for a self-hosted AmneziaWG VPN and selective routing of a home network:
sites from a list go through the tunnel, the rest of the traffic goes directly through the ISP.

## Contents

| Page | About |
|---|---|
| [[Architecture]] | Components, data flow, multi-process mode, data storage |
| [[Installation]] | Installing the gateway and the panel, initial setup |
| [[MikroTik]] | Policy routing, fallback route, NetFlow, rollback |
| [[Configuration]] | `.env` variables and in-panel settings |
| [[Clients]] | VPN client lifecycle, quotas, expiry, config delivery |
| [[Monitoring]] | Dashboard, analytics, map, alerts, notifications, Telegram |
| [[Flows]] | Flow analytics: ClickHouse, dimensions, filter language, examples |
| [[Routing]] | Site list, custom prefixes, route check |
| [[Security]] | Roles, 2FA, sessions, API tokens, OpenBao, audit |
| [[Backups]] | Backup and restore |
| [[API]] | REST API, token authentication, SSE |
| [[Troubleshooting]] | Diagnostics and common issues |
| [[Development]] | Code structure, principles, local run |

## Overview

```
 LAN devices ──► MikroTik ──(dst ∈ vpn-sites)──► gateway (LXC/VM with Docker) ──awg0──► Amnezia server (VPS)
                    │  └──(everything else)──► ISP
                    └── NetFlow v9 ──► flow-collector ──► ClickHouse
 browser ──► Amnezia Control (nginx → FastAPI) ──► PostgreSQL · OpenBao · ClickHouse · SSH to VPS and MikroTik
```

## Key features

- AmneziaWG client management: create, block, expiry, quotas, key reissue, bulk operations.
- QR / `.conf` / `vpn://` and one-time links for handing out access.
- Live monitoring, traffic analytics, connection map on OpenStreetMap.
- Akvorado-style network flow analytics.
- Toast notifications and a notification center, alerts and Telegram notifications, audit log, backups.
- RBAC, 2FA, API tokens, secrets in OpenBao.
