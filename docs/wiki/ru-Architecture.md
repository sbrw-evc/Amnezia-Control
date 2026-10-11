# Архитектура

## Компоненты

| Контейнер | Образ | Роль |
|---|---|---|
| `ac-awg-client` | `amneziavpn/amneziawg-go` | Клиент AmneziaWG шлюза. `network_mode: host`. Весь трафик, пришедший с LAN-интерфейса, уходит в `awg0` (таблица 200), NAT и MSS clamp. Версия протокола совпадает с сервером Amnezia. |
| `ac-postgres` | `postgres:16-alpine` | Клиенты, бакеты трафика (5 мин), подключения, аудит, алерты, операторы, сессии, API-токены, сохранённые фильтры, настройки. |
| `ac-openbao` | `openbao/openbao:2.6` | Хранилище секретов (KV v2 `amnezia/`), raft-storage, static auto-unseal. |
| `ac-bao-init` | `openbao/openbao:2.6` | Одноразовый идемпотентный bootstrap: init, KV, политика, AppRole `backend`, импорт SSH-ключа. |
| `ac-clickhouse` | `clickhouse/clickhouse-server:24.8` | Таблица `flows`, таблица `site_prefixes` и словарь `sites` (`ip_trie`). Лимиты памяти для слабых хостов. |
| `ac-flow-collector` | goflow2 + Python | Приём NetFlow/IPFIX, обогащение (страна, ASN, направление, маршрут, локальное устройство), пакетная запись в ClickHouse. |
| `ac-backend` | Python 3.12, FastAPI | REST API, SSE, фоновые задачи. Несколько процессов uvicorn. |
| `ac-frontend` | nginx + React SPA | Статика SPA, прокси `/api`, кэширующий прокси тайлов OpenStreetMap `/tiles`. |

Сети: `internal` (без выхода наружу: PostgreSQL, OpenBao, ClickHouse) и `egress` (backend, frontend, коллектор).

## Бэкенд

Слои (порты и адаптеры):

- `domain` — сущности-значения и перечисления без ввода-вывода (`Role`, `ClientStatus`, `PeerRuntime`, …).
- `ports` — абстракции: `VpnServerGateway`, `RouterGateway`, `SecretStore`, `GeoLocator`, `Notifier`, `CommandRunner`, `ConfigCodec`.
- `adapters` — реализации: Amnezia в Docker по SSH, MikroTik по SSH, OpenBao (AppRole), DB-IP, Telegram, ClickHouse.
- `db` — модели SQLAlchemy и репозитории (общий базовый `Repository[T]`).
- `services` — бизнес-логика: клиенты, политики, трафик, аналитика, потоки, маршрутизация, алерты, уведомления, бэкапы, аутентификация, токены.
- `api` — роутеры FastAPI и зависимости (аутентификация, RBAC, CSRF).
- `container.py` — composition root: единственное место, где создаются конкретные адаптеры.

### Несколько процессов

API запускается в нескольких процессах (`WEB_CONCURRENCY`). Согласование — через PostgreSQL:

- **Шина событий** — `LISTEN/NOTIFY`: событие из любого процесса получают все SSE-клиенты.
- **Лидер** — session advisory lock. Только лидер выполняет фоновые задачи (опрос сервера, политики, проверки,
  бэкапы, схема ClickHouse). При падении лидера другой процесс перехватывает роль за ~10 секунд.
- **Распределённая блокировка** — все изменения `awg0.conf` сериализуются между процессами.
- **LiveState** — кэш live-метрик в каждом процессе, наполняемый из шины.

CPU-ёмкие операции (argon2, QR-коды, разбор списка сайтов, распаковка баз) выполняются в пуле потоков.

### Фоновые задачи (лидер)

| Задача | Период | Что делает |
|---|---|---|
| traffic | `poll_seconds` | `awg show dump`: дельты трафика, handshake, смена endpoint, геолокация, live-событие |
| policy | 60 с | Блокировка/разблокировка по сроку и квоте, предупреждения |
| health | 60 с | OpenBao, свежесть handshake шлюза |
| router | 60 с | Статус маршрута на MikroTik |
| sync | 5 мин | Импорт пиров, созданных вне панели |
| backup | сутки | Резервная копия и ротация |
| flow-schema | 5 мин | Схема ClickHouse и TTL |
| purge | час | Удаление статистики старше `retention_days` |

## Фронтенд

React 18 + TypeScript + Vite, Tailwind, Framer Motion, AutoAnimate, ECharts, Leaflet, TanStack Query, Zustand.
API-слой — классы `HttpClient` и ресурсные API (`ClientsApi`, `FlowsApi`, …) с общим базовым `Resource`.
Живые данные: одно SSE-соединение (`LiveChannel`) и `LiveQuerySync`, сопоставляющий события с кэшем запросов.
Элементы форм (выпадающий список, чекбокс, переключатель, числовое поле) — собственные компоненты, поэтому выглядят одинаково во всех браузерах.

## Модель данных PostgreSQL

`panel_users`, `panel_sessions`, `api_tokens`, `vpn_clients`, `traffic_buckets`, `connection_events`, `audit_log`,
`alerts`, `share_links`, `saved_filters`, `settings`. Схема создаётся при старте.

## ClickHouse

```sql
flows(TimeReceived DateTime, Direction Enum8('out','in'), Route Enum8('direct','vpn'),
      LocalAddr IPv4, RemoteAddr IPv4, Proto UInt8, LocalPort UInt16, RemotePort UInt16,
      RemoteAS UInt32, RemoteASName String, RemoteCountry String, Bytes UInt64, Packets UInt64, Flows UInt32)
ENGINE = MergeTree PARTITION BY toYYYYMMDD(TimeReceived) TTL TimeReceived + INTERVAL 30 DAY

site_prefixes(prefix, site, grp)  →  DICTIONARY sites LAYOUT(IP_TRIE())
```
