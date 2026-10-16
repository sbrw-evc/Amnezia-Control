#!/bin/bash
set -u
IF=awg0
CONF=/config/awg0.conf
LAN_IF=${LAN_IF:-eth0}
TABLE=200

FWD=DOCKER-USER
iptables -nL $FWD >/dev/null 2>&1 || FWD=FORWARD

cleanup() {
  iptables -D $FWD -i "$LAN_IF" -o $IF -j ACCEPT 2>/dev/null
  iptables -D $FWD -i $IF -o "$LAN_IF" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null
  ip rule del iif "$LAN_IF" lookup $TABLE 2>/dev/null
  iptables -t nat -D POSTROUTING -o $IF -j MASQUERADE 2>/dev/null
  iptables -t mangle -D FORWARD -o $IF -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null
  forwards -D
  awg-quick down "$CONF" 2>/dev/null
}

forwards() {
  for f in ${PORT_FORWARDS:-}; do
    iptables -t nat "$1" PREROUTING -i "$LAN_IF" -m addrtype --dst-type LOCAL -p tcp --dport "${f%%=*}" \
      -j DNAT --to-destination "${f#*=}" 2>/dev/null
  done
}
trap 'cleanup; exit 0' TERM INT

cleanup
grep -q '^Table' "$CONF" || sed -i '/^\[Interface\]/a Table = off' "$CONF"
sed -i '/^DNS *=/d' "$CONF"
export WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
awg-quick up "$CONF" || exit 1

ip route replace default dev $IF table $TABLE
ip route replace "${TUNNEL_NET:-10.8.1.0/24}" dev $IF table $TABLE
for n in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do
  ip route replace throw $n table $TABLE
done
ip rule add iif "$LAN_IF" lookup $TABLE priority 1000
iptables -I $FWD 1 -i "$LAN_IF" -o $IF -j ACCEPT
iptables -I $FWD 1 -i $IF -o "$LAN_IF" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -A POSTROUTING -o $IF -j MASQUERADE
iptables -t mangle -A FORWARD -o $IF -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
forwards -A

echo "awg0 up"; awg show $IF
while true; do sleep 30 & wait $!; ip link show $IF >/dev/null 2>&1 || { echo "awg0 gone"; cleanup; exit 1; }; done
