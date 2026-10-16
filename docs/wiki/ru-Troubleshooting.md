# Диагностика

```bash
cd /opt/amnezia-control
docker compose ps
docker compose logs -f backend
docker compose logs -f awg-client
docker compose logs -f flow-collector
```

## Туннель шлюза

```bash
docker exec ac-awg-client awg show awg0
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

- «Неверный логин или пароль» — проверьте раскладку (кнопка с глазом показывает введённый пароль); после 5 ошибок учётная запись блокируется на 10 минут.
- `INITIAL_ADMIN_PASSWORD` из `.env` действует только до первого входа: панель сразу требует задать собственный пароль, после этого работает только он.
- Забыт пароль — `docker compose exec backend python -m app.cli reset-password admin`.
- Старый интерфейс после обновления — `Ctrl+F5` (HTML не кэшируется, ресурсы версионированы).

## OpenBao

```bash
docker exec ac-openbao bao status -address=http://127.0.0.1:8200
docker compose logs bao-init
```

`Sealed: true` после перезапуска — проверьте наличие и права `openbao/keys/unseal.key` (владелец — пользователь openbao).

## Карта без подложки

Тайлы идут через `/tiles/…` панели. Проверьте `curl -I http://<panel>/tiles/3/4/2.png` — ожидается 200 и заголовок
`X-Tile-Cache`. Серверу нужен доступ к `tile.openstreetmap.org`.

## Медленная загрузка с GitHub через VPN

Симптом: `git clone` и скачивание архивов с GitHub идут на 1–3 Мбит/с, остальные сайты через VPN работают нормально.

Причина: потери в несколько процентов на пути от VPS к дому. Отправители с алгоритмом перегрузки, реагирующим
на потери (CUBIC — у GitHub), на этом обваливаются; отправители с BBR почти не страдают. Проверка: `iperf3 -u -R`
через туннель показывает потери VPS → дом, `mtr` с VPS — потери на последних хопах.

Решение: завершать TCP на VPS и отправлять домой с BBR.

1. На VPS: `sh vps/github-proxy/install.sh` (задайте `PAC_PROXIES=<шлюз>:3128,10.8.1.0:3128`). Скрипт включает BBR
   и запускает `gh-proxy` (HTTPS CONNECT, только порт 443) на адресе туннеля `10.8.1.0:3128`.
2. На шлюзе: `PORT_FORWARDS=3128=10.8.1.0:3128` в `.env`, затем `docker compose up -d awg-client` —
   прокси доступен в LAN как `<шлюз>:3128`.
3. Git: `git config --global http.https://github.com/.proxy http://<шлюз>:3128`.
4. Браузер: системный прокси «Использовать сценарий настройки» — `http://<шлюз>:3128/proxy.pac` (только домены
   GitHub, при недоступности — напрямую).
5. Большие файлы: `aria2c -x16 -s16 --all-proxy=http://<шлюз>:3128 <url>`.

Результат в реальной сети: 1,4 → 150–190 Мбит/с в один поток.
