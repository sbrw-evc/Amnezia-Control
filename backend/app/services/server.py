from __future__ import annotations

import base64
import ipaddress
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from ..adapters.amnezia import AwgConfigCodec
from ..db.base import Database
from ..domain.errors import DomainError
from ..domain.models import KeyPair, PeerEntry
from ..ports import VpnServerGateway
from .audit import AuditService
from .common import Actor

SERVER_ONLY = {"PrivateKey", "Address", "ListenPort", "PostUp", "PostDown", "PreUp", "PreDown",
               "SaveConfig", "Table", "FwMark", "MTU", "DNS"}


def free_address(network: ipaddress.IPv4Network, taken: list[str]) -> str:
    used = {ipaddress.ip_interface(a.strip()).ip for item in taken for a in item.split(",") if a.strip()}
    for ip in network.hosts():
        if ip not in used:
            return f"{ip}/32"
    raise DomainError(f"No free addresses in {network}")


def generate_psk() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def generate_keypair() -> KeyPair:
    k = X25519PrivateKey.generate()
    priv = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return KeyPair(base64.b64encode(priv).decode(), base64.b64encode(pub).decode())


@dataclass
class ServerConfig:
    params: dict
    interface_lines: list[str]
    peers: list[PeerEntry]

    @property
    def obfuscation(self) -> dict:
        return {k: v for k, v in self.params.items() if k not in SERVER_ONLY}

    @property
    def port(self) -> str:
        return self.params.get("ListenPort", "")

    @property
    def network(self) -> ipaddress.IPv4Network:
        return ipaddress.ip_interface(self.params.get("Address", "").split(",")[0].strip()).network

    def peer(self, public_key: str) -> PeerEntry | None:
        return next((p for p in self.peers if p.public_key == public_key), None)

    def free_address(self) -> str:
        server_ip = ipaddress.ip_interface(self.params["Address"].split(",")[0].strip()).ip
        return free_address(self.network, [str(server_ip)] + [p.address for p in self.peers])


class ServerConfigEditor:
    def __init__(self, gateway: VpnServerGateway, lock):
        self.gateway = gateway
        self.codec = AwgConfigCodec()
        self._lock = lock

    async def load(self) -> ServerConfig:
        params, lines, peers = self.codec.parse(await self.gateway.read_config())
        return ServerConfig(params, lines, peers)

    @asynccontextmanager
    async def edit(self):
        async with self._lock.hold():
            cfg = await self.load()
            yield cfg
            await self.gateway.apply_config(self.codec.render(cfg.interface_lines, cfg.peers))

    async def replace(self, text: str) -> None:
        async with self._lock.hold():
            await self.gateway.apply_config(text)


class ServerService:
    def __init__(self, db: Database, editor: ServerConfigEditor, audit: AuditService):
        self._db = db
        self._editor = editor
        self._audit = audit

    async def info(self) -> dict:
        cfg = await self._editor.load()
        gw = self._editor.gateway
        return {"port": cfg.port, "network": str(cfg.network), "params": cfg.obfuscation,
                "peers_total": len(cfg.peers), "peers_disabled": sum(p.disabled for p in cfg.peers),
                "public_key": await gw.server_public_key(), "versions": await gw.versions()}

    async def config(self) -> dict:
        gw = self._editor.gateway
        return {"config": await gw.read_config(), "backups": await gw.list_backups()}

    async def save(self, actor: Actor, text: str) -> None:
        text = text.replace("\r\n", "\n")
        await self._editor.replace(text)
        async with self._db.session() as s:
            self._audit.record(s, actor, "server.config_saved", "server", "", "awg0.conf")

    async def backup(self, name: str) -> str:
        return await self._editor.gateway.read_backup(name)
