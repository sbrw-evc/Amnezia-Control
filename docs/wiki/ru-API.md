# API

Интерактивная документация OpenAPI: `/api/docs` (схема — `/api/openapi.json`).

## Авторизация

- **Браузер** — cookie сессии + заголовок `X-Requested-With: amnezia-control` для изменяющих запросов.
- **Интеграции** — API-токен: `Authorization: Bearer ac_…` (роль задаётся при выпуске).

```bash
curl -H "Authorization: Bearer $TOKEN" http://<panel>/api/analytics/summary
```

## Основные эндпоинты

| Метод | Путь | Роль | Описание |
|---|---|---|---|
| GET | `/api/clients` | наблюдатель | Список клиентов (`q`, `status`, `tag`) |
| POST | `/api/clients` | оператор | Создать клиента |
| GET/PATCH/DELETE | `/api/clients/{id}` | наблюдатель / оператор | Карточка, изменение, удаление |
| POST | `/api/clients/{id}/block` · `/unblock` · `/reissue` | оператор | Блокировка, разблокировка, перевыпуск |
| GET | `/api/clients/{id}/config` · `/config.conf` | оператор | Конфиг (QR, `.conf`, `vpn://`) |
| POST | `/api/clients/{id}/share` | оператор | Одноразовая ссылка |
| POST | `/api/clients/bulk` · `/sync` | оператор | Массовые действия, синхронизация |
| GET | `/api/analytics/summary` · `/live` · `/traffic` · `/top` · `/heatmap` · `/geo` | наблюдатель | Аналитика |
| GET | `/api/flows/status` · `/overview` · `/fields` | наблюдатель | Потоки: статус и обзор |
| POST | `/api/flows/visualize` · `/recent` | наблюдатель | Визуализация и последние потоки |
| GET/POST/DELETE | `/api/flows/filters` | наблюдатель | Сохранённые фильтры |
| GET | `/api/routing/status` · `/custom` | наблюдатель | Маршрутизация |
| POST | `/api/routing/check` | наблюдатель | Куда пойдёт трафик |
| POST | `/api/routing/site-list` · `/custom` | администратор | Загрузка списка, свои подсети |
| GET/PUT | `/api/server/config` | администратор | Конфиг сервера AWG |
| GET/POST/DELETE | `/api/backups` | администратор | Резервные копии |
| GET/POST/DELETE | `/api/tokens` | администратор | API-токены |
| GET/PUT | `/api/settings` | наблюдатель / администратор | Настройки |
| GET | `/api/alerts` · `/api/audit` | наблюдатель / администратор | Алерты, аудит |
| GET | `/api/events` | наблюдатель | Server-Sent Events |

### Пример: визуализация потоков

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://<panel>/api/flows/visualize \
  -d '{"dimensions":["Site","Route"],"limit":10,"graph":"stacked","unit":"bps","filter":"Direction = out"}'
```

## События (SSE)

`GET /api/events` — поток `text/event-stream`:

| Событие | Данные |
|---|---|
| `live` | `t`, `rx`, `tx` (байт/с), `online`, `clients` — скорости по клиентам |
| `clients` | Изменение клиента (`id`) или синхронизация |
| `alert` | Новый или решённый алерт |
| `audit` | Новая запись аудита |
| `connection` | Новое подключение клиента (город, страна) |

## Ошибки

Ответ ошибки: `{"detail": "текст"}`. Коды: 400 — неверные данные, 401 — нужен вход, 403 — нет прав или CSRF,
404 — не найдено, 409 — конфликт, 422 — валидация, 502 — недоступен VPS, MikroTik, OpenBao или ClickHouse.
