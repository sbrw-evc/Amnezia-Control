import time

from ..db.base import Database
from ..db.repositories import SettingRepo

DEFAULTS = {
    "client_dns": "1.1.1.1, 1.0.0.1",
    "endpoint_host": "",
    "poll_seconds": 10,
    "retention_days": 90,
    "quota_warn_percent": 80,
    "expiry_warn_days": 3,
    "default_quota_gb": None,
    "default_valid_days": None,
    "share_link_hours": 24,
    "timezone": "Europe/Moscow",
    "gateway_stale_minutes": 5,
    "notify_enabled": False,
    "notify_min_severity": "warning",
    "notify_telegram_chat_id": "",
    "backup_enabled": True,
    "backup_keep": 14,
    "mt_endpoint_host": "",
    "mt_client_dns": "",
    "mt_allowed_ips": "0.0.0.0/0",
}


class SettingsService:
    TTL = 15

    def __init__(self, db: Database):
        self._db = db
        self._cache: dict | None = None
        self._loaded = 0.0

    async def all(self) -> dict:
        if self._cache is None or time.monotonic() - self._loaded > self.TTL:
            self._loaded = time.monotonic()
            async with self._db.session() as s:
                stored = await SettingRepo(s).get_all()
            self._cache = {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}}
        return dict(self._cache)

    async def get(self, key: str):
        return (await self.all())[key]

    async def update(self, values: dict) -> dict:
        unknown = set(values) - set(DEFAULTS)
        if unknown:
            raise ValueError(f"неизвестные настройки: {', '.join(sorted(unknown))}")
        async with self._db.session() as s:
            repo = SettingRepo(s)
            for k, v in values.items():
                await repo.put(k, v)
        self._cache = None
        return await self.all()
