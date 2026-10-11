# Installation

## Requirements

- A self-hosted Amnezia server with an AmneziaWG container (`amnezia-awg2`, AmneziaWG protocol 2.x/3.x).
- A gateway host on the home network: an LXC container (Proxmox) or a VM with Docker 24+ and Compose v2; 2–3 GB RAM, 10+ GB disk.
  For LXC: unprivileged, `nesting=1`, `/dev/net/tun` passed through.
- MikroTik with RouterOS 7.
- An SSH key on the gateway (`/root/.ssh/id_ed25519`) authorized on the VPS (`root`) and on MikroTik (`admin`).

### LXC on Proxmox

```bash
pct create 210 local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst --hostname amnezia-control \
  --cores 2 --memory 3072 --swap 1024 --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,gw=192.168.0.1,ip=192.168.0.210/24,type=veth \
  --unprivileged 1 --features nesting=1 --onboot 1 --dev0 /dev/net/tun
pct start 210
pct exec 210 -- bash -c "apt-get update && apt-get install -y docker.io docker-compose git openssh-client"
```

Enable forwarding inside the container:

```bash
cat >/etc/sysctl.d/99-gw.conf <<EOF
net.ipv4.ip_forward=1
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
EOF
sysctl -p /etc/sysctl.d/99-gw.conf
```

### SSH key

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519
ssh-copy-id root@<VPS>
```

On MikroTik:

```
/file add name=gw.pub contents="ssh-ed25519 AAAA... "
/user ssh-keys import public-key-file=gw.pub user=admin
```

## Installing the panel

```bash
mkdir -p /opt/amnezia-control && cd /opt/amnezia-control
curl -L https://github.com/sbrw-evc/Amnezia-Control/releases/download/v1.0.0/amnezia-control-1.0.0-deploy.tar.gz   | tar xz --strip-components=1
./install.sh
```

Or clone the repository: `git clone https://github.com/sbrw-evc/Amnezia-Control.git /opt/amnezia-control`.

`install.sh` pulls prebuilt images from GitHub Container Registry; the version is set by `AC_VERSION` in `.env`:

| Image | Platforms |
|---|---|
| `ghcr.io/sbrw-evc/amnezia-control-backend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-frontend` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-flow-collector` | linux/amd64, linux/arm64 |
| `ghcr.io/sbrw-evc/amnezia-control-awg-client` | linux/amd64 |

The first run creates `.env` with random passwords. Fill in the addresses (see [[Configuration]]) and run `./install.sh` again:
it creates the data directories and the OpenBao unseal key, sets permissions and starts the stack.

After the start:

1. Open `PUBLIC_BASE_URL`, sign in as `admin` with the `INITIAL_ADMIN_PASSWORD` and set your own password.
   From then on only the new password works.
2. **VPN clients → New client** — create a client for the gateway (e.g. `home-gateway`), download the `.conf`
   and save it as `awg-client/config/awg0.conf`. Run `docker compose restart awg-client`.
3. Import the MikroTik configuration — see [[MikroTik]].
4. **Routing → Upload ip-list.json** — the site list is applied on the router and loaded into ClickHouse.
5. **Settings → Telegram bot** — optionally connect notifications.

## Updating

Set the new version in `.env` and pull the images:

```bash
cd /opt/amnezia-control
sed -i 's/^AC_VERSION=.*/AC_VERSION=1.0.0/' .env
docker compose pull && docker compose up -d
```

When installed from the repository, `git pull && docker compose up -d --build` builds the images locally.

PostgreSQL and ClickHouse schemas are updated automatically.

## Keep separately

- `openbao/keys/unseal.key` — the OpenBao auto-unseal key. Without it, OpenBao data and snapshots cannot be restored.
- `data/bao-init/init.json` — OpenBao root token and recovery key.
- `.env`.
