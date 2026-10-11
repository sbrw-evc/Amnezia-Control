# Development

## Structure

```
backend/app/
  domain/        value objects and errors
  ports.py       abstractions of external systems
  adapters/      Amnezia (SSH), MikroTik (SSH), OpenBao, ClickHouse, DB-IP, Telegram
  db/            SQLAlchemy models, Database, repositories
  services/      business logic
  api/           FastAPI routers, schemas, dependencies
  cluster.py     event bus, leader election, distributed locks
  workers.py     periodic job scheduler
  container.py   composition root
  cli.py         password reset, backup and restore
frontend/src/
  lib/           HttpClient and resource APIs, SSE, notifications, formatting, hooks
  components/    UI primitives and form controls, charts, map, layout, clients, administration
  pages/         SPA pages
flow-collector/  goflow2 + flow enrichment
awg-client/      AmneziaWG client image for the gateway
openbao/         configuration and bootstrap
clickhouse/      resource limits
mikrotik/        router setup and rollback scripts
```

## Principles

- **SOLID**: services depend on the abstractions in `ports.py`; concrete adapters are created only in `container.py`.
  A new router type or secret store is a new adapter, with no changes to services.
- **DRY**: a shared `Repository[T]`, a single `ServerConfigEditor` for every server config change,
  `useAction` (mutation + notification + invalidation), `notify` for all messages and `Resource` on the frontend.
- The AmneziaWG server is the source of truth for peers; PostgreSQL stores metadata and statistics; keys live only in OpenBao.
- Changes are applied to the server first, then to the database; synchronization resolves any drift.
- Asynchronous I/O everywhere; CPU-heavy work runs in a thread pool.

## Running the frontend locally

```bash
cd frontend
npm install
VITE_API_TARGET=http://<host>:8080 npm run dev
```

## Building

```bash
docker compose build backend frontend flow-collector
docker compose up -d
```

The frontend build runs a type check (`tsc -b`).

## Adding a flow dimension

1. Add a `Field` to `backend/app/services/flowfilter.py` (name, type, column, label, dimension SQL expression).
2. If needed, add a column to `FlowSchema` and populate it in `flow-collector/collector.py`.
3. The frontend picks up the field list from `/api/flows/fields` automatically.
