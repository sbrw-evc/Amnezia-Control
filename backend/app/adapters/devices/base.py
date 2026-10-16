"""Common model of a managed network device: what a driver collects and what it can change.

Every vendor driver turns its API / CLI / SNMP answers into the same `Snapshot`, so the device service,
the network map and the flow enrichment never depend on a vendor.
"""
from __future__ import annotations

import ipaddress
import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field

from ...domain.errors import DomainError

MAC_RE = re.compile(r"^([0-9a-f]{2}[:\-.]?){5}[0-9a-f]{2}$|^([0-9a-f]{4}\.){2}[0-9a-f]{4}$", re.I)


def norm_mac(value: str | None) -> str:
    """Any MAC notation (aa-bb-.., aabb.ccdd.eeff, AABBCCDDEEFF) → aa:bb:cc:dd:ee:ff; '' when not a MAC."""
    if not value:
        return ""
    hexes = re.sub(r"[^0-9a-fA-F]", "", str(value))
    if len(hexes) != 12:
        return ""
    return ":".join(hexes[i:i + 2] for i in range(0, 12, 2)).lower()


def norm_ip(value: str | None) -> str:
    if not value:
        return ""
    value = str(value).strip().split("/")[0].split("%")[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return ""


def to_int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def to_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "yes", "1", "up", "on", "enabled", "running")


@dataclass
class Facts:
    hostname: str = ""
    vendor: str = ""
    model: str = ""
    os: str = ""
    version: str = ""
    serial: str = ""
    mac: str = ""
    uptime_seconds: int | None = None
    cpu_percent: float | None = None
    memory_percent: float | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class Interface:
    name: str
    index: int | None = None
    description: str = ""
    type: str = ""
    mac: str = ""
    admin_up: bool | None = None
    oper_up: bool | None = None
    speed_mbps: int | None = None
    mtu: int | None = None
    addresses: list[str] = field(default_factory=list)
    rx_bytes: int | None = None
    tx_bytes: int | None = None
    vlan: int | None = None


@dataclass
class Neighbor:
    local_interface: str
    remote_name: str = ""
    remote_ip: str = ""
    remote_mac: str = ""
    remote_interface: str = ""
    remote_platform: str = ""
    protocol: str = ""  # lldp | cdp | mndp | controller


@dataclass
class Endpoint:
    """A consumer seen by the device: a host in ARP, a DHCP lease, a Wi-Fi client, a MAC learned on a port."""
    mac: str
    ip: str = ""
    hostname: str = ""
    interface: str = ""
    source: str = "arp"  # arp | dhcp | wifi | bridge | controller
    ssid: str = ""
    signal: int | None = None
    vlan: int | None = None
    attached_to: str = ""  # controllers: MAC of the AP / switch the client is on
    port: str = ""
    rx_rate: float | None = None
    tx_rate: float | None = None
    blocked: bool = False


@dataclass
class Child:
    """A device managed by a controller (Omada, UniFi, Meraki) — an AP, a switch or a gateway."""
    mac: str
    name: str = ""
    model: str = ""
    kind: str = ""  # ap | switch | gateway | other
    ip: str = ""
    online: bool = True
    version: str = ""
    uplink_mac: str = ""
    uplink_port: str = ""
    clients: int | None = None


@dataclass
class Snapshot:
    facts: Facts
    interfaces: list[Interface] = field(default_factory=list)
    neighbors: list[Neighbor] = field(default_factory=list)
    endpoints: list[Endpoint] = field(default_factory=list)
    children: list[Child] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Target:
    host: str
    port: int | None = None
    transport: str = ""  # driver-specific: api | ssh | snmp | https | http
    verify_tls: bool = False
    site: str = ""  # controllers: site name / id
    ssh_host_key: str = ""


@dataclass(frozen=True)
class Credentials:
    username: str = ""
    password: str = ""
    api_key: str = ""
    api_secret: str = ""
    private_key: str = ""
    enable_password: str = ""
    snmp_version: str = "2c"
    snmp_community: str = "public"
    snmp_user: str = ""
    snmp_auth_protocol: str = "sha"
    snmp_auth_password: str = ""
    snmp_priv_protocol: str = "aes"
    snmp_priv_password: str = ""

    SECRET_FIELDS = ("password", "api_key", "api_secret", "private_key", "enable_password", "snmp_community",
                     "snmp_auth_password", "snmp_priv_password")

    @classmethod
    def from_dict(cls, d: dict | None) -> "Credentials":
        d = d or {}
        return cls(**{k: str(v) for k, v in d.items() if k in cls.__dataclass_fields__ and v is not None})


# Settings a driver may support. Parameters are validated here once for every vendor.
ACTIONS: dict[str, str] = {
    "hostname": "Device name",
    "interface": "Interface state / description",
    "dns": "DNS servers",
    "ntp": "NTP servers",
    "flow_export": "NetFlow / IPFIX / sFlow export to a collector",
    "reboot": "Reboot",
    "endpoint_block": "Client blocking",
    "command": "Custom CLI command",
    "backup": "Configuration backup",
}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,62}$")
IFACE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:\- ]{0,63}$")
DESC_RE = re.compile(r"^[^\"'`$;|&<>\\\r\n]{0,120}$")


def validate_action(action: str, params: dict) -> dict:
    """Checks and normalises action parameters; values end up in vendor commands, so they are strict."""
    if action not in ACTIONS:
        raise DomainError(f"Unknown action {action}")
    p = dict(params or {})
    if action == "hostname":
        if not NAME_RE.fullmatch(str(p.get("name", ""))):
            raise DomainError("Name: Latin letters, digits, '.', '_', '-', up to 63 characters")
    elif action == "interface":
        if not IFACE_RE.fullmatch(str(p.get("name", ""))):
            raise DomainError("Invalid interface name")
        if "description" in p and p["description"] is not None and not DESC_RE.fullmatch(str(p["description"])):
            raise DomainError("Description: up to 120 characters, no quotes or special characters")
        if p.get("enabled") is None and p.get("description") is None:
            raise DomainError("Specify the interface state or description")
    elif action in ("dns", "ntp"):
        servers = [s.strip() for s in p.get("servers") or [] if str(s).strip()]
        if not servers or len(servers) > 4:
            raise DomainError("Specify 1 to 4 servers")
        for s in servers:
            if not norm_ip(s) and not re.fullmatch(r"[a-z0-9]([a-z0-9.\-]{0,251}[a-z0-9])?", s, re.I):
                raise DomainError(f"'{s}' is neither an address nor a host name")
        p["servers"] = servers
    elif action == "flow_export":
        if not norm_ip(p.get("collector")):
            raise DomainError("The collector address must be an IP address")
        p["port"] = to_int(p.get("port"), 2055)
        if not 1 <= p["port"] <= 65535:
            raise DomainError("Invalid collector port")
        p["protocol"] = p.get("protocol") or "netflow9"
        if p["protocol"] not in ("netflow5", "netflow9", "ipfix", "sflow"):
            raise DomainError("Protocol: netflow5, netflow9, ipfix or sflow")
        p["enabled"] = p.get("enabled", True) is not False
    elif action == "endpoint_block":
        p["mac"] = norm_mac(p.get("mac"))
        if not p["mac"]:
            raise DomainError("Invalid MAC address")
        p["blocked"] = bool(p.get("blocked", True))
    elif action == "command":
        cmd = str(p.get("command", "")).strip()
        if not cmd or len(cmd) > 2000:
            raise DomainError("The command is empty or too long")
        p["command"] = cmd
    return p


class UnsupportedAction(DomainError):
    def __init__(self, vendor: str, action: str):
        super().__init__(f"{vendor}: action '{ACTIONS.get(action, action)}' is not supported")


class DeviceDriver(ABC):
    """One driver instance talks to one device for one poll or action and is closed afterwards."""

    #: actions from ACTIONS this driver implements
    capabilities: frozenset[str] = frozenset()
    default_transport: str = ""

    def __init__(self, target: Target, creds: Credentials, vendor: str = ""):
        self.target = target
        self.creds = creds
        self.vendor = vendor
        #: SSH host key learned during this session (trust on first use), saved by the service
        self.learned_host_key: str = ""

    @abstractmethod
    async def collect(self) -> Snapshot: ...

    async def apply(self, action: str, params: dict) -> str:
        raise UnsupportedAction(self.vendor, action)

    async def backup(self) -> str:
        raise UnsupportedAction(self.vendor, "backup")

    async def close(self) -> None:
        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()
