from __future__ import annotations

import datetime as dt
import math

from ..adapters.clickhouse import ClickHouseClient
from ..db.base import Database
from ..db.models import SavedFilter
from ..db.repositories import SavedFilterRepo
from ..domain.errors import DomainError
from .audit import AuditService
from .common import Actor, utcnow
from .flowfilter import FIELDS, FilterParser, dimension

UNITS = {"bps": ("Bytes * 8", "бит/с"), "pps": ("Packets", "пакетов/с"), "fps": ("Flows", "потоков/с")}
LIMIT_TYPES = ("avg", "max", "last")
GRAPHS = ("stacked", "stacked100", "lines", "grid", "sankey")


def _ts(v: dt.datetime) -> str:
    return v.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (k - lo)


class FlowSchema:
    def __init__(self, ch: ClickHouseClient):
        self._ch = ch

    async def ensure(self, ttl_days: int) -> None:
        db = self._ch.database
        await self._ch.command(f"CREATE DATABASE IF NOT EXISTS {db}", database="default")
        await self._ch.command(f"""
            CREATE TABLE IF NOT EXISTS {db}.flows (
                TimeReceived DateTime CODEC(DoubleDelta, LZ4),
                Direction Enum8('out' = 1, 'in' = 2),
                Route Enum8('direct' = 1, 'vpn' = 2),
                LocalAddr IPv4,
                RemoteAddr IPv4,
                Proto UInt8,
                LocalPort UInt16,
                RemotePort UInt16,
                RemoteAS UInt32,
                RemoteASName LowCardinality(String),
                RemoteCountry LowCardinality(String),
                Bytes UInt64,
                Packets UInt64,
                Flows UInt32 DEFAULT 1
            ) ENGINE = MergeTree
            PARTITION BY toYYYYMMDD(TimeReceived)
            ORDER BY (TimeReceived, Direction, Route)
            TTL TimeReceived + INTERVAL {int(ttl_days)} DAY""")
        await self._ch.command(f"ALTER TABLE {db}.flows MODIFY TTL TimeReceived + INTERVAL {int(ttl_days)} DAY")
        await self._ch.command(f"""
            CREATE TABLE IF NOT EXISTS {db}.site_prefixes (prefix String, site String, grp String)
            ENGINE = ReplacingMergeTree ORDER BY prefix""")
        await self._ch.command(f"""
            CREATE DICTIONARY IF NOT EXISTS {db}.sites (prefix String, site String, grp String)
            PRIMARY KEY prefix
            SOURCE(CLICKHOUSE(DB '{db}' TABLE 'site_prefixes' USER '{self._ch.user}' PASSWORD '{self._ch.password}'))
            LAYOUT(IP_TRIE())
            LIFETIME(MIN 60 MAX 300)""")


class FlowService:
    def __init__(self, ch: ClickHouseClient, db: Database, audit: AuditService):
        self._ch = ch
        self._db = db
        self._audit = audit
        self.schema = FlowSchema(ch)
        self.sites_seeded = False

    async def load_sites(self, rows: list[tuple[str, str, str]]) -> None:
        await self._ch.command(f"TRUNCATE TABLE IF EXISTS {self._ch.database}.site_prefixes")
        await self.add_sites(rows)

    async def add_sites(self, rows: list[tuple[str, str, str]]) -> None:
        for i in range(0, len(rows), 20000):
            await self._ch.insert("site_prefixes", [{"prefix": p, "site": s, "grp": g} for p, s, g in rows[i:i + 20000]])
        await self._ch.command(f"SYSTEM RELOAD DICTIONARY {self._ch.database}.sites")

    async def remove_site(self, prefix: str) -> None:
        await self._ch.command(f"ALTER TABLE {self._ch.database}.site_prefixes DELETE WHERE prefix = '{prefix}'")
        await self._ch.command(f"SYSTEM RELOAD DICTIONARY {self._ch.database}.sites")

    @staticmethod
    def fields() -> list[dict]:
        return [{"name": f.name, "label": f.label, "kind": f.kind} for f in FIELDS.values()]

    async def status(self) -> dict:
        r = (await self._ch.query(
            "SELECT countIf(TimeReceived >= now() - 60) AS last_minute, max(TimeReceived) AS last_flow, "
            "count() AS total FROM flows"))[0]
        disk = (await self._ch.query(
            "SELECT sum(bytes_on_disk) AS disk FROM system.parts WHERE database = currentDatabase() AND active"))[0]
        last = r["last_flow"] if int(r["total"]) else None
        return {"flows_per_second": round(int(r["last_minute"]) / 60, 2), "last_flow": last,
                "total_flows": int(r["total"]), "disk_bytes": int(disk["disk"] or 0), "ok": await self._ch.ping()}

    async def overview(self) -> dict:
        widgets = {}
        for key, dim in (("as", "RemoteAS"), ("country", "RemoteCountry"), ("site", "Site"), ("proto", "Proto"),
                         ("port", "RemotePort"), ("device", "LocalAddr")):
            expr = dimension(dim).dimension
            rows = await self._ch.query(
                f"SELECT {expr} AS k, sum(Bytes) AS v FROM flows WHERE TimeReceived >= now() - 3600 "
                f"GROUP BY k ORDER BY v DESC LIMIT 8")
            total = sum(int(r["v"]) for r in rows) or 1
            widgets[key] = [{"name": r["k"], "bytes": int(r["v"]), "percent": round(int(r["v"]) * 100 / total, 1)} for r in rows]
        route = await self._ch.query(
            "SELECT toString(Route) AS route, toString(Direction) AS dir, sum(Bytes) AS v FROM flows "
            "WHERE TimeReceived >= now() - 86400 GROUP BY route, dir")
        series = await self._ch.query(
            "SELECT toStartOfInterval(TimeReceived, INTERVAL 600 SECOND) AS t, toString(Direction) AS dir, "
            "sum(Bytes) * 8 / 600 AS v FROM flows WHERE TimeReceived >= now() - 86400 GROUP BY t, dir ORDER BY t")
        last = await self._ch.query(self._records_sql("1", 1))
        return {"widgets": widgets, "routes": [{**r, "v": int(r["v"])} for r in route],
                "series": [{"t": r["t"], "dir": r["dir"], "v": float(r["v"])} for r in series],
                "last_flow": last[0] if last else None, "status": await self.status()}

    async def recent(self, filter_text: str, limit: int = 100) -> list[dict]:
        parser = FilterParser(filter_text)
        where = parser.compile()
        return await self._ch.query(
            self._records_sql(f"TimeReceived >= now() - 3600 AND ({where})", min(int(limit), 500)), parser.params)

    @staticmethod
    def _records_sql(where: str, limit: int) -> str:
        return (
            "SELECT TimeReceived, toString(Direction) AS Direction, toString(Route) AS Route, "
            "IPv4NumToString(LocalAddr) AS LocalAddr, IPv4NumToString(RemoteAddr) AS RemoteAddr, Protocol, "
            "LocalPort, RemotePort, RemoteAS, RemoteASName, RemoteCountry, Site, Bytes, Packets FROM ("
            f"SELECT *, {FIELDS['proto'].dimension} AS Protocol, {FIELDS['site'].dimension} AS Site FROM flows "
            f"WHERE {where} ORDER BY TimeReceived DESC LIMIT {int(limit)}) ORDER BY TimeReceived DESC")

    async def visualize(self, q: dict) -> dict:
        end = dt.datetime.fromisoformat(q["end"]) if q.get("end") else utcnow()
        start = dt.datetime.fromisoformat(q["start"]) if q.get("start") else end - dt.timedelta(hours=6)
        if end.tzinfo is None:
            end = end.replace(tzinfo=dt.timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=dt.timezone.utc)
        if start >= end:
            raise DomainError("Начало периода должно быть раньше конца")
        duration = (end - start).total_seconds()
        points = max(20, min(int(q.get("points") or 200), 600))
        step = max(60, int(math.ceil(duration / points / 60) * 60))
        unit = q.get("unit") if q.get("unit") in UNITS else "bps"
        graph = q.get("graph") if q.get("graph") in GRAPHS else "stacked"
        limit = max(1, min(int(q.get("limit") or 10), 50))
        limit_type = q.get("limitType") if q.get("limitType") in LIMIT_TYPES else "avg"
        dims = [dimension(d) for d in (q.get("dimensions") or [])][:6]
        bidirectional = bool(q.get("bidirectional")) and graph != "sankey"
        if graph == "sankey" and len(dims) < 2:
            raise DomainError("Для Sankey выберите минимум два измерения")

        parser = FilterParser(q.get("filter") or "")
        where = parser.compile()
        params = {**parser.params, "start": _ts(start), "end": _ts(end)}
        base = f"TimeReceived >= {{start:DateTime}} AND TimeReceived < {{end:DateTime}} AND ({where})"
        metric = UNITS[unit][0]
        dim_sql = [d.dimension for d in dims] or ["'Всего'"]
        dim_cols = ", ".join(f"{s} AS d{i}" for i, s in enumerate(dim_sql))
        dim_names = ", ".join(f"d{i}" for i in range(len(dim_sql)))

        if limit_type == "max":
            top_sql = (f"SELECT {dim_names} FROM (SELECT {dim_cols}, toStartOfInterval(TimeReceived, INTERVAL {step} SECOND) AS t, "
                       f"sum({metric}) AS v FROM flows WHERE {base} GROUP BY {dim_names}, t) "
                       f"GROUP BY {dim_names} ORDER BY max(v) DESC LIMIT {limit}")
        elif limit_type == "last":
            params["last_start"] = _ts(end - dt.timedelta(seconds=step * 3))
            top_sql = (f"SELECT {dim_cols} FROM flows WHERE {base} AND TimeReceived >= {{last_start:DateTime}} "
                       f"GROUP BY {dim_names} ORDER BY sum({metric}) DESC LIMIT {limit}")
        else:
            top_sql = f"SELECT {dim_cols} FROM flows WHERE {base} GROUP BY {dim_names} ORDER BY sum({metric}) DESC LIMIT {limit}"
        in_top = f"({dim_names}) IN ({top_sql})" if dims else "1"

        if graph == "sankey":
            rows = await self._ch.query(
                f"SELECT {dim_cols}, sum({metric}) / {duration} AS v FROM flows WHERE {base} AND {in_top} "
                f"GROUP BY {dim_names} ORDER BY v DESC", params)
            return self._sankey(rows, dims, unit)

        key_expr = (f"if({in_top}, [{dim_names}], ['Прочее'])" if dims else "['Всего']")
        dir_expr = "toString(Direction)" if bidirectional else "'out'"
        rows = await self._ch.query(
            f"SELECT toStartOfInterval(TimeReceived, INTERVAL {step} SECOND) AS t, {dir_expr} AS dir, key, "
            f"sum({metric}) / {step} AS v FROM (SELECT *, {dim_cols}, {key_expr} AS key FROM flows WHERE {base}) "
            f"GROUP BY t, dir, key ORDER BY t", params)

        axis = []
        t = start.replace(second=0, microsecond=0)
        t = dt.datetime.fromtimestamp(int(t.timestamp()) // step * step, dt.timezone.utc)
        while t < end:
            axis.append(t)
            t += dt.timedelta(seconds=step)
        index = {a.strftime("%Y-%m-%d %H:%M:%S"): i for i, a in enumerate(axis)}
        series: dict[tuple, list[float]] = {}
        for r in rows:
            i = index.get(r["t"])
            if i is None:
                continue
            key = (r["dir"], tuple(r["key"]))
            series.setdefault(key, [0.0] * len(axis))[i] += float(r["v"])

        out = []
        for (direction, key), values in series.items():
            sign = -1 if bidirectional and direction == "in" else 1
            avg = sum(values) / len(values) if values else 0
            total = sum(values) * step / (8 if unit == "bps" else 1)
            out.append({"name": " · ".join(key), "dimensions": list(key), "direction": direction,
                        "values": [round(v * sign, 3) for v in values],
                        "stats": {"min": min(values), "max": max(values), "last": values[-1] if values else 0,
                                  "avg": avg, "p95": _percentile(values, 0.95), "total": total}})
        out.sort(key=lambda s: (s["direction"] != "out", s["name"] == "Прочее", -s["stats"]["avg"]))

        previous = None
        if q.get("previousPeriod") and graph in ("stacked", "lines"):
            shift = self._previous_shift(duration)
            pparams = {**params, "start": _ts(start - shift), "end": _ts(end - shift)}
            prow = await self._ch.query(
                f"SELECT toStartOfInterval(TimeReceived + {int(shift.total_seconds())}, INTERVAL {step} SECOND) AS t, "
                f"sum({metric}) / {step} AS v FROM flows WHERE {base} "
                + ("AND Direction = 'out' " if bidirectional else "") + "GROUP BY t ORDER BY t", pparams)
            pvals = [0.0] * len(axis)
            for r in prow:
                i = index.get(r["t"])
                if i is not None:
                    pvals[i] = float(r["v"])
            previous = {"label": self._previous_label(duration), "values": pvals}

        return {"axis": [a.isoformat() for a in axis], "step": step, "unit": unit, "unit_label": UNITS[unit][1],
                "graph": graph, "series": out, "previous": previous,
                "dimensions": [d.name for d in dims], "bidirectional": bidirectional,
                "start": start.isoformat(), "end": end.isoformat()}

    @staticmethod
    def _previous_shift(duration: float) -> dt.timedelta:
        for limit, shift in ((3600, dt.timedelta(hours=1)), (86400, dt.timedelta(days=1)),
                             (7 * 86400, dt.timedelta(days=7)), (31 * 86400, dt.timedelta(days=30))):
            if duration <= limit:
                return shift
        return dt.timedelta(days=365)

    @staticmethod
    def _previous_label(duration: float) -> str:
        for limit, label in ((3600, "час назад"), (86400, "день назад"), (7 * 86400, "неделю назад"),
                             (31 * 86400, "месяц назад")):
            if duration <= limit:
                return label
        return "год назад"

    @staticmethod
    def _sankey(rows: list[dict], dims, unit: str) -> dict:
        nodes: dict[str, dict] = {}
        links: dict[tuple[str, str], float] = {}
        n = len(dims)
        for r in rows:
            v = float(r["v"])
            names = [f"{r[f'd{i}']}​" * (i + 1) for i in range(n)]
            for i in range(n):
                nodes.setdefault(names[i], {"name": names[i], "label": r[f"d{i}"], "depth": i})
            for i in range(n - 1):
                links[(names[i], names[i + 1])] = links.get((names[i], names[i + 1]), 0) + v
        return {"graph": "sankey", "unit": unit, "unit_label": UNITS[unit][1], "dimensions": [d.name for d in dims],
                "nodes": list(nodes.values()),
                "links": [{"source": s, "target": t, "value": v} for (s, t), v in links.items()]}

    async def saved_filters(self, actor: Actor) -> list[dict]:
        async with self._db.session() as s:
            rows = await SavedFilterRepo(s).visible(actor.username)
        return [{"id": f.id, "name": f.name, "filter": f.filter, "shared": f.shared, "owner": f.created_by,
                 "mine": f.created_by == actor.username} for f in rows]

    async def save_filter(self, actor: Actor, name: str, text: str, shared: bool) -> dict:
        FilterParser(text).compile()
        async with self._db.session() as s:
            f = SavedFilterRepo(s).add(SavedFilter(name=name.strip()[:128], filter=text, shared=shared,
                                                   created_by=actor.username))
            await s.flush()
            self._audit.record(s, actor, "flows.filter_saved", "filter", f.id, f.name)
            return {"id": f.id}

    async def delete_filter(self, actor: Actor, filter_id: int) -> None:
        async with self._db.session() as s:
            repo = SavedFilterRepo(s)
            f = await repo.require(filter_id)
            if f.created_by != actor.username and actor.role != "admin":
                raise DomainError("Можно удалять только свои фильтры")
            await repo.remove(f)
