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
- **Безопасность** — роли (администратор / оператор / наблюдатель), argon2, 2FA (TOTP), сессии с отзывом,
  API-токены, журнал аудита, секреты только в OpenBao.
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
| `frontend` | SPA + прокси API и тайлов OpenStreetMap |
| `postgres` | клиенты, статистика, аудит, алерты, пользователи |
| `openbao` / `bao-init` | секреты (ключи клиентов, SSH-ключ, TOTP, токен Telegram), auto-unseal |
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
nano .env                 # AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR, PUBLIC_BASE_URL
./install.sh              # поднимет стек
```

Панель: `http://<GATEWAY_IP>:8080`, логин `admin`, пароль — `INITIAL_ADMIN_PASSWORD` из `.env`
(при первом входе потребуется сменить). Затем:

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

Структура, принципы и API — в [Wiki → Разработка](https://github.com/sbrw-evc/Network-Control/wiki/ru-Development).
Интерактивная документация API доступна на `/api/docs`.

## Лицензия

MIT
