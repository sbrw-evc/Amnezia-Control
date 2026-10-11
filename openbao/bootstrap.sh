#!/bin/sh
set -eu
export BAO_ADDR=http://openbao:8200
INIT=/bao/init/init.json
ROLE_DIR=/bao/approle

for i in $(seq 1 60); do
  rc=0; bao status >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 1 ] && break
  sleep 2
done

if bao status -format=json 2>/dev/null | grep -q '"initialized": false'; then
  echo "initializing OpenBao"
  umask 077
  bao operator init -recovery-shares=1 -recovery-threshold=1 -format=json > "$INIT"
fi
for i in $(seq 1 30); do bao status -format=json 2>/dev/null | grep -q '"sealed": false' && break; sleep 2; done

BAO_TOKEN=$(sed -n 's/.*"root_token": *"\([^"]*\)".*/\1/p' "$INIT")
export BAO_TOKEN

bao secrets list -format=json | grep -q '"amnezia/"' || bao secrets enable -path=amnezia -version=2 kv
bao auth list -format=json | grep -q '"approle/"' || bao auth enable approle

bao policy write amnezia-backend - <<'EOF'
path "amnezia/data/*"     { capabilities = ["create", "read", "update", "delete"] }
path "amnezia/metadata/*" { capabilities = ["read", "list", "delete"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
EOF
bao write auth/approle/role/backend token_policies=amnezia-backend token_ttl=1h token_max_ttl=24h \
  secret_id_ttl=0 secret_id_num_uses=0 >/dev/null

mkdir -p "$ROLE_DIR"
umask 077
bao read -field=role_id auth/approle/role/backend/role-id > "$ROLE_DIR/role_id"
[ -s "$ROLE_DIR/secret_id" ] || bao write -f -field=secret_id auth/approle/role/backend/secret-id > "$ROLE_DIR/secret_id"
chmod 644 "$ROLE_DIR/role_id" "$ROLE_DIR/secret_id"

if [ -f /import/ssh_key ] && ! bao kv get amnezia/infra/ssh >/dev/null 2>&1; then
  bao kv put amnezia/infra/ssh private_key=@/import/ssh_key >/dev/null
  echo "SSH key imported into OpenBao"
fi
echo "OpenBao bootstrap done"
