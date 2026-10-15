# Диагностика

```bash
cd /opt/network-control
docker compose ps
docker compose logs -f backend
docker compose logs -f awg-client
docker compose logs -f flow-collector
```

## Туннель шлюза

```bash
docker exec nc-awg-client awg show awg0
ping -c3 -I awg0 10.8.1.0
curl --interface awg0 https://ifconfig.me
ip rule; ip route show table 200
```

- Нет handshake — проверьте, что параметры обфускации и ключи в `awg-client/config/awg0.conf` совпадают с сервером
  (перевыпустите клиента шлюза в панели и замените файл).
- Пинг через туннель есть, но LAN-трафик не проходит — проверьте `DOCKER-USER` (`iptables -S DOCKER-USER`)
  и `net.ipv4.ip_forward=1`.

## Маршрутизация на MikroTik

```
/ip route print where routing-table=to-vpn
/ip firewall mangle print stats where comment~"amnezia"
/tool traceroute 142.250.74.46
```

Если маршрут через туннель неактивен — роутер пингует `10.8.1.0` через шлюз; проверьте маршрут
`10.8.1.0/32` и работу `awg-client`. При падении туннеля трафик идёт через резервный маршрут.

## Потоки не появляются

- `/ip traffic-flow print` — `enabled: yes`, есть target на `GATEWAY_IP:2055`.
- `docker compose logs flow-collector` — строка `goflow2 listening`; раз в 5 минут — счётчики received/written.
- Брандмауэр хоста шлюза должен пропускать UDP 2055.

## Вход в панель

- «Это приложение не подключено к SPA» — задайте `SPA_CONNECTION_KEY` (см. [[Конфигурация|ru-Configuration]]); повреждённый ключ показывается на той же странице.
- «У вас нет роли в Network Control» — администратор SPA должен выдать вам `admin`, `operator` или `viewer`.
- Пароли, ключи доступа и MFA управляются в SPA (меню пользователя → Учётная запись и безопасность).
- «SPA отклонил ключ подключения» в настройках — ключ перевыпущен в SPA: укажите новый в `.env`.
- Старый интерфейс после обновления — `Ctrl+F5` (HTML не кэшируется, ресурсы версионированы).

## OpenBao

```bash
docker exec nc-openbao bao status -address=http://127.0.0.1:8200
docker compose logs bao-init
```

`Sealed: true` после перезапуска — проверьте наличие и права `openbao/keys/unseal.key` (владелец — пользователь openbao).

## Карта без подложки

Тайлы идут через `/tiles/…` панели. Проверьте `curl -I http://<panel>/tiles/3/4/2.png` — ожидается 200 и заголовок
`X-Tile-Cache`. Серверу нужен доступ к `tile.openstreetmap.org`.
