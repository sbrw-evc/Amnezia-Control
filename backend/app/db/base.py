from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import Base

MIGRATIONS = (
    "ALTER TABLE vpn_clients ADD COLUMN IF NOT EXISTS server VARCHAR(16) NOT NULL DEFAULT 'amnezia'",
    "CREATE INDEX IF NOT EXISTS ix_vpn_clients_server ON vpn_clients (server)",
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
