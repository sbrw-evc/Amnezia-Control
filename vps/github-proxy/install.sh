#!/bin/sh
set -eu
cd "$(dirname "$0")"

CONTAINER=${AWG_CONTAINER:-amnezia-awg2}
LISTEN=${LISTEN:-10.8.1.0}
PORT=${PORT:-3128}
PAC_PROXIES=${PAC_PROXIES:-$LISTEN:$PORT}

echo tcp_bbr > /etc/modules-load.d/bbr.conf
modprobe tcp_bbr
cat > /etc/sysctl.d/99-zz-bbr.conf <<EOF
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl -q -p /etc/sysctl.d/99-zz-bbr.conf

mkdir -p /opt/gh-proxy
cp proxy.py /opt/gh-proxy/proxy.py
docker rm -f gh-proxy >/dev/null 2>&1 || true
docker run -d --name gh-proxy --restart always --network "container:$CONTAINER" --cap-add NET_ADMIN \
  --log-opt max-size=1m -e LISTEN="$LISTEN" -e PORT="$PORT" -e CC=bbr -e PAC_PROXIES="$PAC_PROXIES" \
  -v /opt/gh-proxy/proxy.py:/proxy.py:ro python:3.12-alpine python -u /proxy.py >/dev/null
sleep 3
docker logs gh-proxy
