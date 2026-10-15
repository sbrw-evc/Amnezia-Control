# Network Control

[English](README.md) · **Русский**

Панель управления домашней или корпоративной сетью: **сетевые устройства** 25+ платформ с настройкой из панели,
**живая карта сети** вплоть до каждого телефона и телевизора, **анализ потоков** (NetFlow / IPFIX / sFlow → ClickHouse)
с правилами обнаружения и списками угроз — вместе с self-hosted VPN на **AmneziaWG** и выборочной маршрутизацией
(сайты из списка — через туннель, остальное — напрямую через провайдера), алертами в Telegram, резервным копированием
и хранением секретов в OpenBao.

![stack](https://img.shields.io/badge/backend-FastAPI-009688) ![stack](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![stack](https://img.shields.io/badge/db-PostgreSQL%2016-336791) ![stack](https://img.shields.io/badge/flows-ClickHouse-ffcc01)
![stack](https://img.shields.io/badge/secrets-OpenBao-5c4ee5) ![stack](https://img.shields.io/badge/VPN-AmneziaWG%203.x-orange)

## Скриншоты

Обзор с чек-листом **«Первые шаги»** — в светлой и тёмной теме:

| Светлая | Тёмная |
|---|---|
| <img src="docs/screens/overview-light.png" alt="Обзор, светлая тема"> | <img src="docs/screens/overview-dark.png" alt="Обзор, тёмная тема"> |

Остальные страницы показаны в теме вашего GitHub (обе версии — в [`docs/screens`](docs/screens)):

| | |
|---|---|
| **Сетевые устройства**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/devices-dark.png"><img src="docs/screens/devices-light.png" alt="Сетевые устройства"></picture> | **Карта сети**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/network-map-dark.png"><img src="docs/screens/network-map-light.png" alt="Карта сети"></picture> |
| **Анализ потоков**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/flows-dark.png"><img src="docs/screens/flows-light.png" alt="Анализ потоков"></picture> | **Клиенты VPN**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/vpn-clients-dark.png"><img src="docs/screens/vpn-clients-light.png" alt="Клиенты VPN"></picture> |
| **Вход через SPA**<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screens/sign-in-dark.png"><img src="docs/screens/sign-in-light.png" alt="Вход через SPA"></picture> | |

Скриншоты сняты с настоящего приложения на демо-данных: `./scripts/screenshots.sh` (см. [Разработку](#разработка)). Интерфейс на
скриншотах английский; русский включается в меню пользователя.

## Возможности

- **Сетевые устройства** — MikroTik, TP-Link / Omada, UniFi, Keenetic, OpenWrt, OPNsense, pfSense, Cisco, HP / Aruba,
  Dell, Zyxel, Juniper, Huawei, FortiGate, Eltex, серверы Redfish и любые SNMP-устройства: добавление и удаление,
  опрос сведений, интерфейсов со скоростью, соседей LLDP / CDP / MNDP и клиентов; смена имени, интерфейсов, DNS, NTP,
  экспорт потоков, перезагрузка, консоль CLI и резервные копии конфигурации из панели; поиск устройств в подсети.
- **Клиенты сети** — все телефоны, ноутбуки, ТВ и камеры, объединённые из ARP, DHCP, Wi-Fi, контроллеров и портов
  коммутаторов, с производителем по MAC, именами и блокировкой на контроллере.
- **Карта сети** — живой граф по данным устройств: каналы с загрузкой, контроллеры и их точки доступа, клиенты по
  портам и Wi-Fi, трафик каждого клиента, обнаруженные соседи, интернет и VPN.
- **Клиенты VPN** — создание, срок доступа, месячная квота, теги, владелец; блокировка вручную и автоматически
  (срок, квота), перевыпуск ключей, массовые действия, экспорт CSV.
- **Выдача конфигов** — QR и `.conf` для AmneziaWG, ключ `vpn://` для Amnezia VPN, одноразовая ссылка с ограничением по времени.
- **VPN на MikroTik** — WireGuard-сервер на домашнем роутере под управлением панели наравне с Amnezia: настройка в один клик,
  тот же жизненный цикл клиентов, квоты, трафик и конфиги; клиентам доступна домашняя сеть, сайты из списка — через Amnezia.
- **Мониторинг** — live-скорость (SSE), трафик по периодам, топ клиентов, тепловая карта активности, страны.
- **Карта подключений** — OpenStreetMap (собственный кэширующий прокси тайлов), геолокация DB-IP Lite.
- **Анализ потоков** — NetFlow v5 / v9, IPFIX и sFlow с любых устройств в ClickHouse с 5-минутными и часовыми
  агрегатами (до 2 лет); экспортёры и интерфейсы, приложения, имена клиентов, обратный DNS; визуализация
  (stacked / 100% / lines / grid / sankey), топ по среднему / пикам / последним, двунаправленный режим, сравнение с
  прошлым периодом, язык фильтров, сохранённые фильтры и представления, состояние в URL.
- **Правила и угрозы** — пороги, объёмные и SYN DDoS, сканирование портов и хостов, аномалии и падения относительно
  недельной нормы, молчащие экспортёры, загрузка каналов, контакты со списками FireHOL / Spamhaus / abuse.ch → алерты
  со ссылкой на трафик.
- **Маршрутизация** — статус туннеля на MikroTik, загрузка списка сайтов (`ip-list.json`), свои домены и подсети,
  проверка «куда пойдёт трафик», автоматический переход на провайдера при падении туннеля.
- **Сервер AWG** — параметры обфускации, редактор `awg0.conf` с резервными копиями и применением без разрыва соединений.
- **Безопасность** — вход и доступ управляются в [SPA — единой точке авторизации](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-) (пароли, ключи доступа, MFA,
  каталоги — там), роли (администратор / оператор / наблюдатель) назначаются в SPA, сессии с отзывом,
  API-токены, журнал аудита, секреты только в OpenBao.
- **Первые шаги и пошаговая настройка** — на обзоре чек-лист от установки до работающей панели (подключение SPA,
  адрес приложения, первое устройство, приём потоков, VPN-клиент, уведомления в Telegram, резервные копии), а на
  страницах устройств, анализа потоков, VPN-клиентов, маршрутизации и настроек — пошаговые руководства; каждый шаг
  проверяется по реальным данным и отмечается сам, когда выполнен.
- **Уведомления** — всплывающие уведомления (до 5 одновременно) для всех событий приложения и центр уведомлений с историей.
- **Эксплуатация** — алерты (VPS, шлюз, туннель, OpenBao, квоты, сроки) с уведомлениями в Telegram,
  ежедневные резервные копии (PostgreSQL + снапшот OpenBao), несколько процессов API с выбором лидера.

## Архитектура

```
 LAN ──► MikroTik ──(dst ∈ vpn-sites)──► шлюз (Docker-хост) ──awg0──► сервер Amnezia (VPS)
            │  └─(остальное)──► провайдер
 маршрутизаторы, коммутаторы, МСЭ ── NetFlow / IPFIX / sFlow ──► flow-collector ──► ClickHouse
            ▲ REST / RCI / SSH CLI / SNMP                                            ▲
 браузер ──► frontend (nginx) ──► backend (FastAPI ×N) ──► PostgreSQL · OpenBao · SSH (VPS)
```

| Сервис | Назначение |
|---|---|
| `awg-client` | AmneziaWG-клиент шлюза: policy routing LAN → `awg0`, NAT, MSS clamp |
| `backend` | REST API, SSE, драйверы устройств, фоновые задачи (опрос VPN и устройств, политики, правила, здоровье, бэкапы) |
| `frontend` | веб-интерфейс (React) + прокси API и тайлов OpenStreetMap |
| `postgres` | клиенты, статистика, аудит, алерты, пользователи |
| `openbao` / `bao-init` | секреты (ключи клиентов, SSH-ключ, токен Telegram, при желании ключ подключения к SPA), auto-unseal |
| `clickhouse` | сетевые потоки и агрегаты; словари сайтов, угроз, экспортёров, интерфейсов и хостов |
| `flow-collector` | goflow2 (NetFlow / IPFIX UDP 2055, sFlow UDP 6343) + обогащение (страна, ASN, направление, маршрут, экспортёр) |

Подробности — в [Wiki](https://github.com/sbrw-evc/Network-Control/wiki/ru-Home).

## Поддерживаемые устройства

| Сегмент | Платформы |
|---|---|
| Дом | MikroTik, Keenetic, OpenWrt (GL.iNet, Turris, Cudy…), TP-Link Archer / Deco (SNMP), ASUS Merlin, Synology (SSH / SNMP) |
| Малый бизнес | контроллер TP-Link Omada и коммутаторы JetStream, Ubiquiti UniFi и EdgeRouter / VyOS, OPNsense, pfSense, Zyxel, Dell PowerSwitch N, Netgear, D-Link |
| Корпоративный | Cisco IOS / IOS-XE / NX-OS и Meraki, HP ProCurve / HPE Aruba (ArubaOS-Switch, AOS-CX), HPE Comware / H3C, Dell OS10, Juniper Junos, Huawei VRP, Fortinet FortiGate, Eltex, серверы через Redfish (iDRAC, iLO, XCC, Supermicro) |
| Всё остальное | SNMP v1 / v2c / v3 со стандартными MIB |

Что собирается и что можно менять на каждой платформе — [Wiki → Сетевые устройства](https://github.com/sbrw-evc/Network-Control/wiki/ru-Devices).

## Быстрый старт

Требования: Docker 24+ с Compose v2, доступ по SSH-ключу к VPS с Amnezia и к MikroTik (RouterOS 7).

```bash
git clone https://github.com/sbrw-evc/Network-Control.git /opt/network-control
cd /opt/network-control
./install.sh              # создаст .env с паролями
nano .env                 # AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR, PUBLIC_BASE_URL, SPA_CONNECTION_KEY
./install.sh              # поднимет стек
```

### Вход и доступ управляются в SPA

У Network Control нет собственных паролей: вход — через
[SPA — единую точку авторизации](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-) (OpenID Connect), которая также назначает роли
(`admin`, `operator`, `viewer`) и синхронизирует пользователей каждые 5 минут. Чтобы подключить, в SPA откройте
**Приложения → Подключить приложение**, тип `network-control`, адрес `PUBLIC_BASE_URL`, назначьте людям или группам
роли и укажите ключ подключения `spa1.…` в `SPA_CONNECTION_KEY` в `.env` — см.
[протокол](https://github.com/sbrw-evc/SPA-Single-point-of-authorization-/blob/main/docs/protocol.md) и [Конфигурацию](https://github.com/sbrw-evc/Network-Control/wiki/ru-Configuration).

> [!IMPORTANT]
> **Назначьте себе роль «Администратор» в SPA до подключения.** Первая синхронизация отключает всех локальных
> пользователей, которых нет в SPA, — в том числе старого локального `admin` — и отзывает их сессии и API-токены. Без
> администратора из SPA открыть настройки потом будет некому. Существующий локальный пользователь сохраняется (вместе
> с историей в журнале аудита), если в SPA есть человек с тем же именем пользователя; дальше он привязан к этой учётной
> записи SPA.

Переход со встроенного входа панели (до 2.0): пароли и TOTP 2FA убраны — MFA теперь в SPA. Старые TOTP-секреты в
OpenBao (`users/<id>/totp`) удаляются при первой успешной синхронизации с SPA (в журнале аудита —
`spa.legacy_totp_purged`); если OpenBao откажет, попытка повторится при следующей синхронизации.

Панель: `http://<GATEWAY_IP>:8080` → **Войти через SPA**. Затем:

1. Создайте в панели клиента для шлюза, сохраните его конфиг в `awg-client/config/awg0.conf`, перезапустите `awg-client`.
2. Импортируйте на MikroTik `mikrotik/network-control.rsc` (адреса в начале файла).
3. Загрузите список сайтов в разделе «Маршрутизация».

Пошагово — [Установка](https://github.com/sbrw-evc/Network-Control/wiki/ru-Installation).

## Docker-образы

Каждый релиз публикует образы в GitHub Container Registry (теги `X.Y.Z`, `X.Y`, `latest`):

| Образ | Платформы |
|---|---|
| `ghcr.io/sbrw-evc/network-control-backend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-frontend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-flow-collector` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/network-control-awg-client` | linux/amd64 |

Версия задаётся `NC_VERSION` в `.env`; `install.sh` скачивает образы, `docker compose up -d --build` собирает их локально.
На странице релиза также есть `network-control-X.Y.Z-deploy.tar.gz` — всё необходимое для запуска без клонирования репозитория.

## Разработка

```bash
cd frontend && npm install && VITE_API_TARGET=http://<host>:8080 npm run dev
```

Демо-данные и скриншоты: `backend/demo/run.py` запускает настоящий backend на базе PostgreSQL, которую он очищает
и заполняет демо-данными; SPA, ClickHouse, OpenBao, VPN-сервер, роутер и драйверы устройств заменены заглушками
(встроенный OpenID Connect-провайдер, встраиваемый chdb, имитации с растущими счётчиками), а вход проходит по
настоящему протоколу SPA от имени демо-администратора. `./scripts/screenshots.sh` собирает веб-приложение, запускает
демо и снимает `docs/screens/*.png` через Playwright в обеих темах:

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
DEMO_DATABASE_URL=postgresql+asyncpg://user:pass@127.0.0.1:5432/nc_demo ./scripts/screenshots.sh
```

Структура, принципы и API — в [Wiki → Разработка](https://github.com/sbrw-evc/Network-Control/wiki/ru-Development).
Интерактивная документация API доступна на `/api/docs`.

## Лицензия

MIT
