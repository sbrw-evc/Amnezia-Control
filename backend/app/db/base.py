from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import Base

MIGRATIONS = (
    "ALTER TABLE vpn_clients ADD COLUMN IF NOT EXISTS server VARCHAR(16) NOT NULL DEFAULT 'amnezia'",
    "CREATE INDEX IF NOT EXISTS ix_vpn_clients_server ON vpn_clients (server)",
    "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS link VARCHAR(1024) NOT NULL DEFAULT ''",
    # Sign-in moves to SPA: users are bound to SPA user IDs; passwords, TOTP 2FA and the lockout go away.
    "ALTER TABLE panel_users ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'local'",
    "ALTER TABLE panel_users ADD COLUMN IF NOT EXISTS external_id VARCHAR(256)",
    "ALTER TABLE panel_users ADD COLUMN IF NOT EXISTS email VARCHAR(256) NOT NULL DEFAULT ''",
    "ALTER TABLE panel_users ADD COLUMN IF NOT EXISTS groups VARCHAR(128)[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE panel_users ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_panel_users_external ON panel_users (source, external_id) WHERE external_id IS NOT NULL",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS password_hash",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS totp_enabled",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS must_change_password",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS failed_attempts",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS locked_until",
    "ALTER TABLE panel_users DROP COLUMN IF EXISTS password_changed_at",
    "DROP TABLE IF EXISTS panel_password_history",
    "DROP TABLE IF EXISTS panel_passkeys",
    "ALTER TABLE panel_sessions DROP COLUMN IF EXISTS pending_2fa",
    "ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES panel_users (id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS ix_api_tokens_user_id ON api_tokens (user_id)",
    "UPDATE api_tokens t SET user_id = u.id FROM panel_users u WHERE t.user_id IS NULL AND lower(u.username) = lower(t.created_by)",
)


class Database:
    def __init__(self, url: str):
        self.engine = create_async_engine(url, pool_size=10, max_overflow=5, pool_pre_ping=True)
        self._factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_schema(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            for sql in MIGRATIONS:
                await conn.execute(text(sql))

    @asynccontextmanager
    async def session(self):
        s: AsyncSession = self._factory()
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise
        finally:
            await s.close()
