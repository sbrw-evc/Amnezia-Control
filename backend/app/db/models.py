import datetime as dt
import uuid

from sqlalchemy import (BigInteger, Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String,
                        Text, func)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ..domain.models import BlockReason, ClientStatus, Role, Severity


def _enum(e):
    return Enum(e, values_callable=lambda x: [m.value for m in x], native_enum=False, length=16)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PanelUser(TimestampMixin, Base):
    __tablename__ = "panel_users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[Role] = mapped_column(_enum(Role), default=Role.VIEWER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class PanelSession(TimestampMixin, Base):
    __tablename__ = "panel_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("panel_users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(256), default="")
    pending_2fa: Mapped[bool] = mapped_column(Boolean, default=False)


class VpnClient(TimestampMixin, Base):
    __tablename__ = "vpn_clients"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    owner: Mapped[str] = mapped_column(String(128), default="")
    contact: Mapped[str] = mapped_column(String(128), default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    address: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[ClientStatus] = mapped_column(_enum(ClientStatus), default=ClientStatus.ACTIVE)
    block_reason: Mapped[BlockReason | None] = mapped_column(_enum(BlockReason))
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger)
    managed: Mapped[bool] = mapped_column(Boolean, default=False)
    system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    last_handshake_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_endpoint: Mapped[str | None] = mapped_column(String(64))
    country_code: Mapped[str | None] = mapped_column(String(2))
    country: Mapped[str | None] = mapped_column(String(64))
    city: Mapped[str | None] = mapped_column(String(128))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    raw_rx: Mapped[int] = mapped_column(BigInteger, default=0)
    raw_tx: Mapped[int] = mapped_column(BigInteger, default=0)
    total_rx: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tx: Mapped[int] = mapped_column(BigInteger, default=0)
    config_downloaded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class TrafficBucket(Base):
    __tablename__ = "traffic_buckets"
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vpn_clients.id", ondelete="CASCADE"), primary_key=True)
    bucket: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    rx: Mapped[int] = mapped_column(BigInteger, default=0)
    tx: Mapped[int] = mapped_column(BigInteger, default=0)
    __table_args__ = (Index("ix_traffic_bucket", "bucket"),)


class ConnectionEvent(Base):
    __tablename__ = "connection_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vpn_clients.id", ondelete="CASCADE"), index=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip: Mapped[str] = mapped_column(String(64))
    port: Mapped[int | None] = mapped_column(Integer)
    country_code: Mapped[str | None] = mapped_column(String(2))
    country: Mapped[str | None] = mapped_column(String(64))
    city: Mapped[str | None] = mapped_column(String(128))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)


class AuditEntry(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    target_name: Mapped[str] = mapped_column(String(128), default="")
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    ip: Mapped[str] = mapped_column(String(64), default="")


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(128), index=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    severity: Mapped[Severity] = mapped_column(_enum(Severity))
    title: Mapped[str] = mapped_column(String(256))
    message: Mapped[str] = mapped_column(Text, default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by: Mapped[str | None] = mapped_column(String(64))


class ShareLink(TimestampMixin, Base):
    __tablename__ = "share_links"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vpn_clients.id", ondelete="CASCADE"))
    created_by: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    uses_left: Mapped[int] = mapped_column(Integer, default=1)


class ApiToken(TimestampMixin, Base):
    __tablename__ = "api_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(16))
    role: Mapped[Role] = mapped_column(_enum(Role))
    created_by: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class SavedFilter(TimestampMixin, Base):
    __tablename__ = "saved_filters"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    filter: Mapped[str] = mapped_column(Text)
    shared: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(64))


class SettingRow(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
