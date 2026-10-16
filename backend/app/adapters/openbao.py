import asyncio
import os

import httpx

from ..domain.errors import ExternalServiceError
from ..ports import SecretStore


class OpenBaoSecretStore(SecretStore):
    def __init__(self, addr: str, approle_dir: str, mount: str):
        self._client = httpx.AsyncClient(base_url=addr, timeout=10)
        self._approle_dir = approle_dir
        self._mount = mount
        self._token: str | None = None
        self._lock = asyncio.Lock()

    def _read(self, name: str) -> str:
        with open(os.path.join(self._approle_dir, name)) as f:
            return f.read().strip()

    async def _login(self) -> str:
        async with self._lock:
            if self._token:
                return self._token
            r = await self._client.post("/v1/auth/approle/login", json={
                "role_id": self._read("role_id"), "secret_id": self._read("secret_id")})
            if r.status_code != 200:
                raise ExternalServiceError(f"OpenBao: AppRole login failed ({r.status_code})")
            self._token = r.json()["auth"]["client_token"]
            return self._token

    async def _request(self, method: str, url: str, **kw) -> httpx.Response:
        for attempt in (1, 2):
            token = await self._login()
            try:
                r = await self._client.request(method, url, headers={"X-Vault-Token": token}, **kw)
            except httpx.HTTPError as e:
                raise ExternalServiceError(f"OpenBao is unreachable: {e}") from e
            if r.status_code == 403 and attempt == 1:
                self._token = None
                continue
            return r
        return r

    async def get(self, path: str) -> dict | None:
        r = await self._request("GET", f"/v1/{self._mount}/data/{path}")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ExternalServiceError(f"OpenBao: reading {path} returned {r.status_code}")
        return r.json()["data"]["data"]

    async def put(self, path: str, data: dict) -> None:
        r = await self._request("POST", f"/v1/{self._mount}/data/{path}", json={"data": data})
        if r.status_code not in (200, 204):
            raise ExternalServiceError(f"OpenBao: writing {path} returned {r.status_code}")

    async def delete(self, path: str) -> None:
        r = await self._request("DELETE", f"/v1/{self._mount}/metadata/{path}")
        if r.status_code not in (200, 204, 404):
            raise ExternalServiceError(f"OpenBao: deleting {path} returned {r.status_code}")

    async def keys(self, prefix: str) -> list[str]:
        r = await self._request("LIST", f"/v1/{self._mount}/metadata/{prefix.strip('/')}")
        if r.status_code == 404:
            return []
        if r.status_code != 200:
            raise ExternalServiceError(f"OpenBao: listing {prefix} returned {r.status_code}")
        return [str(k) for k in (r.json().get("data") or {}).get("keys") or []]

    async def snapshot(self) -> bytes:
        r = await self._request("GET", "/v1/sys/storage/raft/snapshot", timeout=120)
        if r.status_code != 200:
            raise ExternalServiceError(f"OpenBao: snapshot unavailable ({r.status_code})")
        return r.content

    async def healthy(self) -> bool:
        try:
            r = await self._client.get("/v1/sys/health")
            return r.status_code == 200
        except httpx.HTTPError:
            return False
