from __future__ import annotations

from abc import ABC, abstractmethod

from .domain.models import GeoPoint, PeerEntry, PeerRuntime


class SecretStore(ABC):
    @abstractmethod
    async def get(self, path: str) -> dict | None: ...

    @abstractmethod
    async def put(self, path: str, data: dict) -> None: ...

    @abstractmethod
    async def delete(self, path: str) -> None: ...

    @abstractmethod
    async def healthy(self) -> bool: ...


class CommandRunner(ABC):
    @abstractmethod
    async def run(self, command: str, stdin: str | None = None, timeout: float = 30) -> str: ...


class VpnServerGateway(ABC):
    @abstractmethod
    async def read_config(self) -> str: ...

    @abstractmethod
    async def apply_config(self, text: str) -> None:
        ...

    @abstractmethod
    async def runtime(self) -> dict[str, PeerRuntime]: ...

    @abstractmethod
    async def server_public_key(self) -> str: ...

    @abstractmethod
    async def preshared_key(self) -> str | None: ...

    @abstractmethod
    async def read_clients_table(self) -> list[dict]: ...

    @abstractmethod
    async def write_clients_table(self, table: list[dict]) -> None: ...

    @abstractmethod
    async def list_backups(self) -> list[str]: ...

    @abstractmethod
    async def read_backup(self, name: str) -> str: ...

    @abstractmethod
    async def versions(self) -> dict: ...


class GeoLocator(ABC):
    @abstractmethod
    def lookup(self, ip: str) -> GeoPoint | None: ...


class RouterGateway(ABC):
    @abstractmethod
    async def status(self) -> dict: ...

    @abstractmethod
    async def replace_address_list(self, cidrs: list[str]) -> int: ...

    @abstractmethod
    async def list_addresses(self) -> list[str]: ...

    @abstractmethod
    async def add_address(self, cidr: str) -> None: ...

    @abstractmethod
    async def remove_address(self, cidr: str) -> None: ...


class Notifier(ABC):
    @abstractmethod
    async def send(self, text: str) -> None: ...

    @abstractmethod
    async def configured(self) -> bool: ...


class ConfigCodec(ABC):
    @abstractmethod
    def parse(self, text: str) -> tuple[dict, list[str], list[PeerEntry]]: ...

    @abstractmethod
    def render(self, interface_lines: list[str], peers: list[PeerEntry]) -> str: ...
