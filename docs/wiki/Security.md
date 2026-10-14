# Security

## Roles

| Role | Permissions |
|---|---|
| Administrator | Everything: server, routing, operators, tokens, audit, backups, settings |
| Operator | VPN clients: create, edit, block, hand out configs, reissue, delete |
| Viewer | Read-only access to monitoring, analytics and flows |

Lockout protection: the last administrator cannot be deleted or demoted, and users cannot change their own role or disable themselves.

## Authentication

- Passwords are hashed with argon2id; at least 10 characters and two character classes.
- An account is locked for 10 minutes after 5 failed attempts; sign-in attempts are rate-limited per IP.
- Sessions are random tokens in an httpOnly `SameSite=Strict` cookie; only the SHA-256 is stored in the database. Sessions can be listed and revoked in the profile.
- Changing the password ends all other sessions. New operators and reset passwords must be changed at sign-in.
- 2FA (TOTP) — the secret is stored in OpenBao; an administrator can disable 2FA for a user.
- CSRF — state-changing requests require the `X-Requested-With: network-control` header.
- Password fields have a show/hide button.

## API tokens

Issued by administrators ("Panel access" page) with a role and an expiry. Format `ac_…`, shown once,
only the hash is stored. Used as `Authorization: Bearer ac_…`; they do not grant access to the profile or sessions.

## Secrets

| Secret | Where it is stored |
|---|---|
| Client private keys | OpenBao `amnezia/clients/<id>` |
| SSH key for the VPS and MikroTik | OpenBao `amnezia/infra/ssh` (the backend writes it only to a temporary tmpfs) |
| TOTP secrets | OpenBao `amnezia/users/<id>/totp` |
| Telegram bot token | OpenBao `amnezia/notify/telegram` |
| Database, ClickHouse and first administrator passwords | `.env` (mode 600) |

The backend authenticates to OpenBao with an AppRole whose policy is limited to `amnezia/*` and reading the raft snapshot.
OpenBao, PostgreSQL and ClickHouse do not publish any ports.

**Static auto-unseal**: OpenBao is unsealed automatically with `openbao/keys/unseal.key`. This is convenient for
unattended operation, but the key lives on the same host: protect the host and keep a copy of the key elsewhere.

## Audit

The log records sign-ins and failed attempts, every client operation (including each config disclosure and share-link open),
changes to the server config, site list, custom prefixes, settings, operators, tokens, and backups.
Filters by action type and search; entries appear in real time.

## Recommendations

- Expose the panel only on the LAN or through a VPN; for external access use a reverse proxy with HTTPS and `COOKIE_SECURE=true`.
- Enable 2FA for administrators.
- Use dedicated SSH keys and a restricted user on MikroTik.
