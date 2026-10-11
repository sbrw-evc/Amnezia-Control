from __future__ import annotations

import enum
from dataclasses import dataclass, field


class Role(str, enum.Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"

    def allows(self, required: "Role") -> bool:
        order = [Role.VIEWER, Role.OPERATOR, Role.ADMIN]
        return order.index(self) >= order.index(required)


class ClientStatus(str, enum.Enum):
    ACTIVE = "active"
    BLOCKED = "blocked"
    MISSING = "missing"


class BlockReason(str, enum.Enum):
    MANUAL = "manual"
    EXPIRED = "expired"
    QUOTA = "quota"


class Severity(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass(frozen=True)
class PeerRuntime:
    public_key: str
    endpoint: str | None
    allowed_ips: str
    latest_handshake: int
    rx: int
    tx: int

    @property
    def endpoint_ip(self) -> str | None:
        if not self.endpoint:
            return None
        host = self.endpoint.rsplit(":", 1)[0]
        return host.strip("[]")


@dataclass
class PeerEntry:
    public_key: str
    address: str
    preshared_key: str | None
    disabled: bool
    lines: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class GeoPoint:
    country_code: str | None
    country: str | None
    city: str | None
    lat: float | None
    lon: float | None


@dataclass(frozen=True)
class KeyPair:
    private_key: str
    public_key: str
