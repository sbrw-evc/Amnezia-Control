# Amnezia Control

[English](README.md) · **Русский**

Панель управления self-hosted сервером **AmneziaWG** и выборочной маршрутизацией домашней сети через VPN:
сайты из списка открываются через туннель, всё остальное — напрямую через провайдера.
Включает учёт трафика, карту подключений, анализ сетевых потоков в духе Akvorado (NetFlow → ClickHouse),
алерты в Telegram, резервное копирование и хранение секретов в OpenBao.

![stack](https://img.shields.io/badge/backend-FastAPI-009688) ![stack](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![stack](https://img.shields.io/badge/db-PostgreSQL%2016-336791) ![stack](https://img.shields.io/badge/flows-ClickHouse-ffcc01)
![stack](https://img.shields.io/badge/secrets-OpenBao-5c4ee5) ![stack](https://img.shields.io/badge/VPN-AmneziaWG%203.x-orange)

## Возможности

- **Клиенты VPN** — создание, срок доступа, месячная квота, теги, владелец; блокировка вручную и автоматически
  (срок, квота), перевыпуск ключей, массовые действия, экспорт CSV.
- **Выдача конфигов** — QR и `.conf` для AmneziaWG, ключ `vpn://` для Amnezia VPN, одноразовая ссылка с ограничением по времени.
- **Мониторинг** — live-скорость (SSE), трафик по периодам, топ клиентов, тепловая карта активности, страны.
- **Карта подключений** — OpenStreetMap (собственный кэширующий прокси тайлов), геолокация DB-IP Lite.
- **Анализ потоков** — NetFlow v9 с MikroTik в ClickHouse; обзор, визуализация (stacked / 100% / lines / grid / sankey),
  измерения, топ по среднему/пикам/последним, двунаправленный режим, сравнение с прошлым периодом,
  язык фильтров, сохранённые фильтры, состояние в URL.
- **Маршрутизация** — статус туннеля на MikroTik, загрузка списка сайтов (`ip-list.json`), свои подсети,
  проверка «куда пойдёт трафик», автоматический переход на провайдера при падении туннеля.
- **Сервер AWG** — параметры обфускации, редактор `awg0.conf` с резервными копиями и применением без разрыва соединений.
- **Безопасность** — роли (администратор / оператор / наблюдатель), argon2, 2FA (TOTP), сессии с отзывом,
  API-токены, журнал аудита, секреты только в OpenBao.
- **Уведомления** — всплывающие уведомления (до 5 одновременно) для всех событий приложения и центр уведомлений с историей.
- **Эксплуатация** — алерты (VPS, шлюз, туннель, OpenBao, квоты, сроки) с уведомлениями в Telegram,
  ежедневные резервные копии (PostgreSQL + снапшот OpenBao), несколько процессов API с выбором лидера.

## Архитектура

```
 LAN ──► MikroTik ──(dst ∈ vpn-sites)──► шлюз (Docker-хост) ──awg0──► сервер Amnezia (VPS)
            │  └─(остальное)──► провайдер
            └─ NetFlow v9 ──► flow-collector ──► ClickHouse
                                                     ▲
 браузер ──► frontend (nginx) ──► backend (FastAPI ×N) ──► PostgreSQL · OpenBao · SSH (VPS, MikroTik)
```

| Сервис | Назначение |
|---|---|
| `awg-client` | AmneziaWG-клиент шлюза: policy routing LAN → `awg0`, NAT, MSS clamp |
| `backend` | REST API, SSE, фоновые задачи (опрос, политики, здоровье, бэкапы) |
| `frontend` | SPA + прокси API и тайлов OpenStreetMap |
| `postgres` | клиенты, статистика, аудит, алерты, пользователи |
| `openbao` / `bao-init` | секреты (ключи клиентов, SSH-ключ, TOTP, токен Telegram), auto-unseal |
| `clickhouse` | сетевые потоки, словарь сайтов (`ip_trie`) |
| `flow-collector` | goflow2 + обогащение (страна, ASN, направление, маршрут) |

Подробности — в [Wiki](https://github.com/sbrw-evc/Amnezia-Control/wiki/ru-Home).

## Быстрый старт

Требования: Docker 24+ с Compose v2, доступ по SSH-ключу к VPS с Amnezia и к MikroTik (RouterOS 7).

```bash
git clone https://github.com/sbrw-evc/Amnezia-Control.git /opt/amnezia-control
cd /opt/amnezia-control
./install.sh              # создаст .env с паролями
nano .env                 # AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR, PUBLIC_BASE_URL
./install.sh              # поднимет стек
```

Панель: `http://<GATEWAY_IP>:8080`, логин `admin`, пароль — `INITIAL_ADMIN_PASSWORD` из `.env`
(при первом входе потребуется сменить). Затем:

1. Создайте в панели клиента для шлюза, сохраните его конфиг в `awg-client/config/awg0.conf`, перезапустите `awg-client`.
2. Импортируйте на MikroTik `mikrotik/amnezia-control.rsc` (адреса в начале файла).
3. Загрузите список сайтов в разделе «Маршрутизация».

Пошагово — [Установка](https://github.com/sbrw-evc/Amnezia-Control/wiki/ru-Installation).

## Разработка

```bash
cd frontend && npm install && VITE_API_TARGET=http://<host>:8080 npm run dev
```

Структура, принципы и API — в [Wiki → Разработка](https://github.com/sbrw-evc/Amnezia-Control/wiki/ru-Development).
Интерактивная документация API доступна на `/api/docs`.

## Лицензия

MIT
