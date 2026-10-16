# Установка

## Требования

- Сервер Amnezia (self-hosted) с контейнером AmneziaWG (`amnezia-awg2`, протокол AmneziaWG 2.x/3.x).
- Хост шлюза в домашней сети: LXC (Proxmox) или VM с Docker 24+ и Compose v2; 2–3 ГБ ОЗУ, 10+ ГБ диска.
  Для LXC: unprivileged, `nesting=1`, проброс `/dev/net/tun`.
- MikroTik с RouterOS 7.
- SSH-ключ на шлюзе (`/root/.ssh/id_ed25519`), добавленный на VPS (`root`) и на MikroTik (`admin`).

### LXC в Proxmox

```bash
pct create 210 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst --hostname amnezia-control \
  --cores 2 --memory 3072 --swap 1024 --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,gw=192.168.0.1,ip=192.168.0.210/24,type=veth \
  --unprivileged 1 --features nesting=1 --onboot 1 --dev0 /dev/net/tun
pct start 210
pct exec 210 -- bash -c "apt-get update && apt-get install -y docker.io docker-compose git openssh-client"
```

В контейнере включите форвардинг:

```bash
cat >/etc/sysctl.d/99-gw.conf <<EOF
net.ipv4.ip_forward=1
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
EOF
sysctl -p /etc/sysctl.d/99-gw.conf
```

### SSH-ключ

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519
ssh-copy-id root@<VPS>
```

На MikroTik:

```
/file add name=gw.pub contents="ssh-ed25519 AAAA... "
/user ssh-keys import public-key-file=gw.pub user=admin
```

## Установка панели

```bash
mkdir -p /opt/amnezia-control && cd /opt/amnezia-control
curl -L https://github.com/sbrw-evc/Amnezia-Control/releases/download/v1.0.0/amnezia-control-1.0.0-deploy.tar.gz   | tar xz --strip-components=1
./install.sh
```

Или клонируйте репозиторий: `git clone https://github.com/sbrw-evc/Amnezia-Control.git /opt/amnezia-control`.

`install.sh` скачивает готовые образы из GitHub Container Registry; версия задаётся `AC_VERSION` в `.env`:

| Образ | Платформы |
|---|---|
| `ghcr.io/sbrw-evc/amnezia-control-backend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-frontend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-flow-collector` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-awg-client` | linux/amd64 |

Первый запуск создаёт `.env` со случайными паролями. Заполните адреса (см. [[Конфигурация|ru-Configuration]]) и запустите `./install.sh` ещё раз:
он создаст каталоги данных и ключ распечатки OpenBao, выставит права и поднимет стек.

После запуска:

1. Откройте `PUBLIC_BASE_URL`, войдите как `admin` с паролем `INITIAL_ADMIN_PASSWORD` и задайте свой пароль.
   После этого работает только новый пароль.
2. **Клиенты VPN → Новый клиент** — создайте клиента для шлюза (например, `home-gateway`), скачайте `.conf`
   и сохраните как `awg-client/config/awg0.conf`. Выполните `docker compose restart awg-client`.
3. Импортируйте конфигурацию MikroTik — [[Настройка MikroTik|ru-MikroTik]].
4. **Маршрутизация → Загрузить ip-list.json** — список сайтов будет применён на роутере и загружен в ClickHouse.
5. **Настройки → Telegram-бот** — при необходимости подключите уведомления.

## Обновление

Укажите новую версию в `.env` и скачайте образы:

```bash
cd /opt/amnezia-control
sed -i 's/^AC_VERSION=.*/AC_VERSION=1.0.0/' .env
docker compose pull && docker compose up -d
```

При установке из репозитория `git pull && docker compose up -d --build` соберёт образы локально.

Схемы PostgreSQL и ClickHouse обновляются автоматически.

## Что сохранить отдельно

- `openbao/keys/unseal.key` — ключ автоматической распечатки OpenBao. Без него данные OpenBao и снапшоты не восстановить.
- `data/bao-init/init.json` — root-токен и recovery-ключ OpenBao.
- `.env`.
