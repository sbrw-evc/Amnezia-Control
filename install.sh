#!/bin/sh
set -eu
cd "$(dirname "$0")"

secret() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-28; }

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^INITIAL_ADMIN_PASSWORD=.*/INITIAL_ADMIN_PASSWORD=$(secret)/" .env
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(secret)/" .env
  sed -i "s/^CLICKHOUSE_PASSWORD=.*/CLICKHOUSE_PASSWORD=$(secret)/" .env
  chmod 600 .env
  echo "Создан .env — укажите AWG_HOST, ROUTER_HOST, GATEWAY_IP, LAN_CIDR и запустите install.sh снова."
  exit 0
fi

grep -q '^AWG_HOST=203.0.113.10' .env && { echo "Укажите AWG_HOST в .env"; exit 1; }

mkdir -p data/postgres data/openbao data/bao-init data/approle data/backend data/clickhouse data/geoip data/tiles \
  openbao/keys awg-client/config
[ -s openbao/keys/unseal.key ] || head -c 32 /dev/urandom > openbao/keys/unseal.key

BAO_IMAGE="openbao/openbao:$(sed -n 's/^OPENBAO_VERSION=//p' .env)"
docker pull -q "$BAO_IMAGE" >/dev/null
BAO_UID=$(docker run --rm --entrypoint id "$BAO_IMAGE" -u openbao)
BAO_GID=$(docker run --rm --entrypoint id "$BAO_IMAGE" -g openbao)
chown -R "$BAO_UID:$BAO_GID" data/openbao openbao/keys
chmod 700 openbao/keys data/bao-init
chmod 400 openbao/keys/unseal.key
chown 101:101 data/tiles

if [ ! -s awg-client/config/awg0.conf ]; then
  echo "Внимание: нет awg-client/config/awg0.conf — шлюз не поднимется, пока вы не создадите для него клиента."
fi

docker compose up -d --build
echo
echo "Amnezia Control запущен: $(sed -n 's/^PUBLIC_BASE_URL=//p' .env)"
echo "Логин: $(sed -n 's/^INITIAL_ADMIN_USER=//p' .env), пароль: см. INITIAL_ADMIN_PASSWORD в .env"
echo "Сохраните openbao/keys/unseal.key и data/bao-init/init.json в надёжном месте."
