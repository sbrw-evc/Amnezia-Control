# API

Interactive OpenAPI documentation: `/api/docs` (schema — `/api/openapi.json`).

## Authentication

- **Browser** — session cookie + the `X-Requested-With: amnezia-control` header for state-changing requests.
- **Integrations** — an API token: `Authorization: Bearer ac_…` (the role is set when the token is issued).

```bash
curl -H "Authorization: Bearer $TOKEN" http://<panel>/api/analytics/summary
```

## Main endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/clients` | viewer | Client list (`q`, `status`, `tag`) |
| POST | `/api/clients` | operator | Create a client |
| GET/PATCH/DELETE | `/api/clients/{id}` | viewer / operator | Details, update, delete |
| POST | `/api/clients/{id}/block` · `/unblock` · `/reissue` | operator | Block, unblock, reissue |
| GET | `/api/clients/{id}/config` · `/config.conf` | operator | Config (QR, `.conf`, `vpn://`) |
| POST | `/api/clients/{id}/share` | operator | One-time link |
| POST | `/api/clients/bulk` · `/sync` | operator | Bulk actions, synchronization |
| GET | `/api/analytics/summary` · `/live` · `/traffic` · `/top` · `/heatmap` · `/geo` | viewer | Analytics |
| GET | `/api/flows/status` · `/overview` · `/fields` | viewer | Flows: status and overview |
| POST | `/api/flows/visualize` · `/recent` | viewer | Visualization and recent flows |
| GET/POST/DELETE | `/api/flows/filters` | viewer | Saved filters |
| GET | `/api/routing/status` · `/custom` | viewer | Routing |
| POST | `/api/routing/check` | viewer | Where will the traffic go |
| POST | `/api/routing/site-list` · `/custom` | administrator | Site list upload, custom prefixes |
| GET/PUT | `/api/server/config` | administrator | AWG server config |
| GET/POST/DELETE | `/api/backups` | administrator | Backups |
| GET/POST/DELETE | `/api/tokens` | administrator | API tokens |
| GET/PUT | `/api/settings` | viewer / administrator | Settings |
| GET | `/api/alerts` · `/api/audit` | viewer / administrator | Alerts, audit |
| GET | `/api/events` | viewer | Server-Sent Events |

### Example: flow visualization

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://<panel>/api/flows/visualize \
  -d '{"dimensions":["Site","Route"],"limit":10,"graph":"stacked","unit":"bps","filter":"Direction = out"}'
```

## Events (SSE)

`GET /api/events` — a `text/event-stream`:

| Event | Data |
|---|---|
| `live` | `t`, `rx`, `tx` (bytes/s), `online`, `clients` — per-client rates |
| `clients` | A client changed (`id`) or a synchronization happened |
| `alert` | A new or resolved alert |
| `audit` | A new audit entry |
| `connection` | A new client connection (city, country) |

## Errors

Error response: `{"detail": "text"}`. Codes: 400 — invalid data, 401 — sign-in required, 403 — no permission or CSRF,
404 — not found, 409 — conflict, 422 — validation, 502 — the VPS, MikroTik, OpenBao or ClickHouse is unavailable.
