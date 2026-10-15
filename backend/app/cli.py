import argparse
import asyncio

from .adapters.openbao import OpenBaoSecretStore
from .config import get_settings
from .db.base import Database
from .services.audit import AuditService
from .services.backups import BackupService
from .services.common import EventBus
from .services.settings import SettingsService


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
    sub.add_parser("backup")
    rd = sub.add_parser("restore-db")
    rd.add_argument("archive")
    args = p.parse_args()
    if args.cmd == "backup":
        asyncio.run(backup("create", None))
    else:
        asyncio.run(backup("restore", args.archive))


if __name__ == "__main__":
    main()
