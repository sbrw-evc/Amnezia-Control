import json

import httpx

from ..domain.errors import DomainError, ExternalServiceError


class ClickHouseClient:
    def __init__(self, url: str, user: str, password: str, database: str):
        self._http = httpx.AsyncClient(base_url=url, timeout=60,
                                       headers={"X-ClickHouse-User": user, "X-ClickHouse-Key": password})
        self.database = database
        self.user = user
        self.password = password

    async def _post(self, sql: str, params: dict | None = None, body: bytes | None = None,
                    database: str | None = None) -> httpx.Response:
        query = {"database": database if database is not None else self.database}
        for k, v in (params or {}).items():
            query[f"param_{k}"] = v if isinstance(v, str) else json.dumps(v)
        content = body if body is not None else sql.encode()
        if body is not None:
            query["query"] = sql
        try:
            r = await self._http.post("/", params=query, content=content)
        except httpx.HTTPError as e:
            raise ExternalServiceError(f"ClickHouse недоступен: {e}") from e
        if r.status_code != 200:
            msg = " ".join(r.text.split())[:600]
            if "SYNTAX_ERROR" in msg or "Code: 62" in msg or "Code: 47" in msg:
                raise DomainError(f"Ошибка запроса: {msg}")
            raise ExternalServiceError(f"ClickHouse: {msg}")
        return r

    async def command(self, sql: str, database: str | None = None) -> None:
        await self._post(sql, database=database)

    async def query(self, sql: str, params: dict | None = None) -> list[dict]:
        r = await self._post(sql + "\nFORMAT JSON", params)
        return r.json()["data"]

    async def insert(self, table: str, rows: list[dict]) -> None:
        if not rows:
            return
        body = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows).encode()
        await self._post(f"INSERT INTO {table} FORMAT JSONEachRow", body=body)

    async def ping(self) -> bool:
        try:
            r = await self._http.get("/ping")
            return r.status_code == 200
        except httpx.HTTPError:
            return False
