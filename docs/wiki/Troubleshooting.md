# Troubleshooting

```bash
cd /opt/network-control
docker compose ps
docker compose logs -f backend
docker compose logs -f awg-client
docker compose logs -f flow-collector
```

## Gateway tunnel

```bash
docker exec nc-awg-client awg show awg0
ping -c3 -I awg0 10.8.1.0
curl --interface awg0 https://ifconfig.me
ip rule; ip route show table 200
```

- No handshake — make sure the obfuscation parameters and keys in `awg-client/config/awg0.conf` match the server
  (reissue the gateway client in the panel and replace the file).
- The tunnel answers pings but LAN traffic does not pass — check `DOCKER-USER` (`iptables -S DOCKER-USER`)
  and `net.ipv4.ip_forward=1`.

## Routing on MikroTik

```
/ip route print where routing-table=to-vpn
/ip firewall mangle print stats where comment~"amnezia"
/tool traceroute 142.250.74.46
```

If the tunnel route is inactive — the router pings `10.8.1.0` through the gateway; check the `10.8.1.0/32` route
and that `awg-client` is running. While the tunnel is down, traffic uses the fallback route.

## No flows

- `/ip traffic-flow print` — `enabled: yes`, a target pointing at `GATEWAY_IP:2055`.
- `docker compose logs flow-collector` — the `goflow2 listening` line; received/written counters every 5 minutes.
- The gateway host firewall must allow UDP 2055.

## Signing in

- "Invalid login or password" — check the keyboard layout (the eye button reveals the typed password); after 5 failures the account is locked for 10 minutes.
- `INITIAL_ADMIN_PASSWORD` from `.env` is valid only until the first sign-in: the panel immediately asks you to set your own password, and only that password works afterwards.
- Forgotten password — `docker compose exec backend python -m app.cli reset-password admin`.
- Old UI after an update — `Ctrl+F5` (HTML is not cached, assets are versioned).

## OpenBao

```bash
docker exec nc-openbao bao status -address=http://127.0.0.1:8200
docker compose logs bao-init
```

`Sealed: true` after a restart — check that `openbao/keys/unseal.key` exists and has the right permissions (owned by the openbao user).

## Map without tiles

Tiles are served through the panel's `/tiles/…`. Check `curl -I http://<panel>/tiles/3/4/2.png` — expect 200 and an
`X-Tile-Cache` header. The server needs access to `tile.openstreetmap.org`.
