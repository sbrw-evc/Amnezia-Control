from __future__ import annotations

import asyncio
import datetime as dt
import io
import json
import os
import re
import tarfile
import uuid

from sqlalchemy import DateTime, select, text
from sqlalchemy.dialects.postgresql import UUID

from ..db.base import Database
from ..db.models import Base
from ..domain.errors import DomainError, NotFound
from .audit import AuditService
from .common import Actor
from .settings import SettingsService

NAME_RE = re.compile(r"^(?:network|amnezia)-control-\d{8}-\d{6}\.tar\.gz$")
VERSION = 1


class BackupService:
    def __init__(self, db: Database, secrets, settings: SettingsService, audit: AuditService, directory: str):
        self._db = db
        self._secrets = secrets
        self._settings = settings
        self._audit = audit
        self._dir = directory

    def _path(self, name: str) -> str:
        if not NAME_RE.match(name):
            raise DomainError("Invalid archive name")
        path = os.path.join(self._dir, name)
        if not os.path.exists(path):
            raise NotFound("Archive not found")
        return path

    def list(self) -> list[dict]:
        os.makedirs(self._dir, exist_ok=True)
        items = []
        for name in sorted(os.listdir(self._dir), reverse=True):
            if NAME_RE.match(name):
                st = os.stat(os.path.join(self._dir, name))
                items.append({"name": name, "size": st.st_size,
                              "created_at": dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat()})
        return items

    def file(self, name: str) -> str:
        return self._path(name)

    async def delete(self, actor: Actor, name: str) -> None:
        os.remove(self._path(name))
        async with self._db.session() as s:
            self._audit.record(s, actor, "backup.deleted", "backup", "", name)

    async def _export_tables(self) -> dict:
        out = {}
        async with self._db.session() as s:
            for table in Base.metadata.sorted_tables:
                rows = (await s.execute(select(table))).mappings().all()
                out[table.name] = [dict(r) for r in rows]
        return out

    async def create(self, actor: Actor | None = None) -> dict:
        os.makedirs(self._dir, exist_ok=True)
        tables = await self._export_tables()
        snapshot = await self._secrets.snapshot()
        now = dt.datetime.now(dt.timezone.utc)
        name = f"network-control-{now.strftime('%Y%m%d-%H%M%S')}.tar.gz"
        manifest = {"version": VERSION, "created_at": now.isoformat(),
                    "tables": {k: len(v) for k, v in tables.items()}, "openbao_snapshot_bytes": len(snapshot)}
        db_json = json.dumps(tables, default=str, ensure_ascii=False).encode()

        def write() -> None:
            tmp = os.path.join(self._dir, f".{name}.tmp")
            with tarfile.open(tmp, "w:gz") as tar:
                for member, data in (("manifest.json", json.dumps(manifest, indent=2).encode()),
                                     ("database.json", db_json), ("openbao.snap", snapshot)):
                    info = tarfile.TarInfo(member)
                    info.size, info.mtime, info.mode = len(data), int(now.timestamp()), 0o600
                    tar.addfile(info, io.BytesIO(data))
            os.chmod(tmp, 0o600)
            os.replace(tmp, os.path.join(self._dir, name))

        await asyncio.to_thread(write)
        async with self._db.session() as s:
            self._audit.record(s, actor or Actor.system(), "backup.created", "backup", "", name, **manifest["tables"])
        await self.rotate()
        return {"name": name, **manifest}

    async def rotate(self) -> None:
        keep = int(await self._settings.get("backup_keep") or 14)
        for item in self.list()[keep:]:
            os.remove(os.path.join(self._dir, item["name"]))

    async def scheduled(self) -> None:
        if await self._settings.get("backup_enabled"):
            await self.create()

    async def restore_database(self, path: str) -> dict:
        with tarfile.open(path, "r:gz") as tar:
            tables = json.loads(tar.extractfile("database.json").read())
        counts = {}
        async with self._db.session() as s:
            names = ", ".join(t.name for t in Base.metadata.sorted_tables)
            await s.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
            for table in Base.metadata.sorted_tables:
                rows = [self._coerce(table, r) for r in tables.get(table.name, [])]
                if rows:
                    await s.execute(table.insert(), rows)
                counts[table.name] = len(rows)
            for table in Base.metadata.sorted_tables:
                pk = list(table.primary_key.columns)
                if len(pk) == 1 and pk[0].autoincrement is not False and str(pk[0].type) in ("INTEGER", "BIGINT"):
                    await s.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk[0].name}'), "
                        f"COALESCE((SELECT MAX({pk[0].name}) FROM {table.name}), 0) + 1, false)"))
        return counts

    @staticmethod
    def _coerce(table, row: dict) -> dict:
        out = {}
        for col in table.columns:
            v = row.get(col.name)
            if v is not None and isinstance(col.type, DateTime):
                v = dt.datetime.fromisoformat(v)
            elif v is not None and isinstance(col.type, UUID):
                v = uuid.UUID(v)
            out[col.name] = v
        return out
