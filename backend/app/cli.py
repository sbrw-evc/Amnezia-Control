import argparse
import asyncio
import secrets

from .adapters.openbao import OpenBaoSecretStore
from .config import get_settings
from .db.base import Database
from .db.repositories import SessionRepo, UserRepo
from .services.audit import AuditService
from .services.auth import PasswordHasher
from .services.backups import BackupService
from .services.common import EventBus
from .services.settings import SettingsService


async def reset_password(username: str) -> None:
    cfg = get_settings()
    db = Database(cfg.database_url)
    password = secrets.token_urlsafe(14)
    async with db.session() as s:
        user = await UserRepo(s).by_username(username)
        if not user:
            raise SystemExit(f"user {username} not found")
        user.password_hash = await PasswordHasher().ahash(password)
        user.must_change_password = True
        user.locked_until = None
        user.failed_attempts = 0
        await SessionRepo(s).revoke_user(user.id)
    await db.engine.dispose()
    print(f"temporary password for {username}: {password}")


async def backup(action: str, path: str | None) -> None:
    cfg = get_settings()
    db = Database(cfg.database_url)
    await db.create_schema()
    svc = BackupService(db, OpenBaoSecretStore(cfg.bao_addr, cfg.bao_approle_dir, cfg.bao_kv_mount),
                        SettingsService(db), AuditService(db, EventBus()), cfg.backup_dir)
    if action == "create":
        print(await svc.create())
    else:
        print(await svc.restore_database(path))
    await db.engine.dispose()


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("reset-password")
    r.add_argument("username")
    sub.add_parser("backup")
    rd = sub.add_parser("restore-db")
    rd.add_argument("archive")
    args = p.parse_args()
    if args.cmd == "reset-password":
        asyncio.run(reset_password(args.username))
    elif args.cmd == "backup":
        asyncio.run(backup("create", None))
    else:
        asyncio.run(backup("restore", args.archive))


if __name__ == "__main__":
    main()
