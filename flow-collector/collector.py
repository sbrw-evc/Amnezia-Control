import asyncio
import datetime as dt
import gzip
import ipaddress
import json
import logging
import os
import time

import httpx
import maxminddb

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("collector")
logging.getLogger("httpx").setLevel(logging.WARNING)

CH_URL = os.environ.get("CLICKHOUSE_URL", "http://clickhouse:8123")
CH_USER = os.environ.get("CLICKHOUSE_USER", "amnezia")
CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")
CH_DB = os.environ.get("CLICKHOUSE_DB", "flows")
LAN = ipaddress.ip_network(os.environ.get("LAN_CIDR", "192.168.0.0/24"))
GATEWAY = os.environ.get("GATEWAY_IP", "192.168.0.210")
VPN_HOST = os.environ.get("AWG_HOST", "")
GEO_DIR = os.environ.get("GEOIP_DIR", "/data")
LISTEN = os.environ.get("FLOW_LISTEN", "netflow://:2055")
BATCH = int(os.environ.get("BATCH_SIZE", "5000"))
FLUSH_SECONDS = float(os.environ.get("FLUSH_SECONDS", "5"))
PROTOCOLS = {"ICMP": 1, "TCP": 6, "UDP": 17, "GRE": 47, "ESP": 50, "AH": 51, "SCTP": 132}
DATABASES = {"city": "dbip-city-lite", "asn": "dbip-asn-lite"}


class GeoEnricher:
    def __init__(self, directory: str):
        self._dir = directory
        self._readers: dict[str, maxminddb.Reader] = {}
        self._cache: dict[str, tuple] = {}

    async def refresh(self) -> None:
        os.makedirs(self._dir, exist_ok=True)
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as http:
            for kind, base in DATABASES.items():
                path = os.path.join(self._dir, f"{base}.mmdb")
                if os.path.exists(path) and time.time() - os.path.getmtime(path) < 35 * 86400:
                    self._open(kind, path)
                    continue
                today = dt.date.today()
                for d in (today, today.replace(day=1) - dt.timedelta(days=1)):
                    try:
                        r = await http.get(f"https://download.db-ip.com/free/{base}-{d.strftime('%Y-%m')}.mmdb.gz")
                    except httpx.HTTPError as e:
                        log.warning("geo download %s: %s", base, e)
                        continue
                    if r.status_code == 200:
                        data = await asyncio.to_thread(gzip.decompress, r.content)
                        with open(path + ".tmp", "wb") as f:
                            f.write(data)
                        os.replace(path + ".tmp", path)
                        log.info("downloaded %s", base)
                        break
                if os.path.exists(path):
                    self._open(kind, path)
        self._cache.clear()

    def _open(self, kind: str, path: str) -> None:
        self._readers[kind] = maxminddb.open_database(path)

    def lookup(self, ip: str) -> tuple[str, int, str]:
        hit = self._cache.get(ip)
        if hit:
            return hit
        country, asn, org = "", 0, ""
        city = self._readers.get("city")
        if city:
            rec = city.get(ip) or {}
            country = (rec.get("country") or {}).get("iso_code") or ""
        asdb = self._readers.get("asn")
        if asdb:
            rec = asdb.get(ip) or {}
            asn = int(rec.get("autonomous_system_number") or 0)
            org = rec.get("autonomous_system_organization") or ""
        if len(self._cache) > 200_000:
            self._cache.clear()
        self._cache[ip] = (country, asn, org)
        return self._cache[ip]


def pick(flow: dict, *names, default=None):
    for n in names:
        if n in flow and flow[n] not in (None, ""):
            return flow[n]
    return default


class Classifier:
    def __init__(self, geo: GeoEnricher):
        self._geo = geo

    def __call__(self, flow: dict) -> dict | None:
        src, dst = pick(flow, "src_addr", "SrcAddr"), pick(flow, "dst_addr", "DstAddr")
        if not src or not dst or ":" in src or ":" in dst:
            return None
        s, d = ipaddress.ip_address(src), ipaddress.ip_address(dst)
        if s in LAN and d in LAN:
            return None
        if VPN_HOST and VPN_HOST in (src, dst):
            return None
        if s.is_multicast or d.is_multicast or d == ipaddress.ip_address("255.255.255.255"):
            return None
        proto = pick(flow, "proto", "Proto", default=0)
        proto = PROTOCOLS.get(str(proto).upper(), proto) if not str(proto).isdigit() else int(proto)
        sport, dport = int(pick(flow, "src_port", "SrcPort", default=0)), int(pick(flow, "dst_port", "DstPort", default=0))
        if s in LAN:
            direction, local, remote, lport, rport = "out", src, dst, sport, dport
            route = "vpn" if pick(flow, "next_hop", "NextHop", default="") == GATEWAY else "direct"
        else:
            direction, local, remote, lport, rport = "in", dst, src, dport, sport
            route = "vpn" if d in LAN else "direct"
        country, asn, org = self._geo.lookup(remote)
        rate = int(pick(flow, "sampling_rate", "SamplingRate", default=1) or 1)
        received = int(pick(flow, "time_received_ns", "TimeReceivedNs", default=0)) // 1_000_000_000 \
            or int(pick(flow, "time_received", "TimeReceived", default=0)) or int(time.time())
        return {"TimeReceived": received, "Direction": direction, "Route": route, "LocalAddr": local, "RemoteAddr": remote,
                "Proto": int(proto or 0), "LocalPort": lport, "RemotePort": rport, "RemoteAS": asn, "RemoteASName": org,
                "RemoteCountry": country, "Bytes": int(pick(flow, "bytes", "Bytes", default=0)) * rate,
                "Packets": int(pick(flow, "packets", "Packets", default=0)) * rate, "Flows": 1}


class ClickHouseWriter:
    def __init__(self):
        self._http = httpx.AsyncClient(base_url=CH_URL, timeout=60,
                                       headers={"X-ClickHouse-User": CH_USER, "X-ClickHouse-Key": CH_PASSWORD})
        self.written = 0

    async def wait_ready(self) -> None:
        while True:
            try:
                r = await self._http.post("/", params={"query": f"EXISTS TABLE {CH_DB}.flows"})
                if r.status_code == 200 and r.text.strip() == "1":
                    return
            except httpx.HTTPError:
                pass
            log.info("waiting for %s.flows", CH_DB)
            await asyncio.sleep(10)

    async def write(self, rows: list[dict]) -> None:
        body = "\n".join(json.dumps(r) for r in rows).encode()
        for attempt in range(5):
            try:
                r = await self._http.post("/", params={"query": f"INSERT INTO {CH_DB}.flows FORMAT JSONEachRow"},
                                          content=body)
                if r.status_code == 200:
                    self.written += len(rows)
                    return
                log.warning("insert failed: %s", r.text[:300])
            except httpx.HTTPError as e:
                log.warning("insert error: %s", e)
            await asyncio.sleep(2 * (attempt + 1))
        log.error("dropping %d flows after retries", len(rows))


async def run() -> None:
    geo = GeoEnricher(GEO_DIR)
    await geo.refresh()
    classify = Classifier(geo)
    writer = ClickHouseWriter()
    await writer.wait_ready()
    buffer: list[dict] = []
    last_flush = time.monotonic()
    stats = {"received": 0, "skipped": 0}

    async def flush() -> None:
        nonlocal buffer, last_flush
        if buffer:
            rows, buffer = buffer, []
            await writer.write(rows)
        last_flush = time.monotonic()

    async def periodic() -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            if time.monotonic() - last_flush >= FLUSH_SECONDS:
                await flush()

    async def report() -> None:
        while True:
            await asyncio.sleep(300)
            log.info("flows received=%d skipped=%d written=%d", stats["received"], stats["skipped"], writer.written)

    async def georefresh() -> None:
        while True:
            await asyncio.sleep(86400)
            await geo.refresh()

    tasks = [asyncio.create_task(periodic()), asyncio.create_task(report()), asyncio.create_task(georefresh())]
    while True:
        proc = await asyncio.create_subprocess_exec(
            "goflow2", f"-listen={LISTEN}", "-format=json", "-transport=file",
            stdout=asyncio.subprocess.PIPE, limit=1 << 20)
        log.info("goflow2 listening on %s", LISTEN)
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            stats["received"] += 1
            try:
                row = classify(json.loads(line))
            except (ValueError, KeyError):
                row = None
            if row is None:
                stats["skipped"] += 1
                continue
            buffer.append(row)
            if len(buffer) >= BATCH:
                await flush()
        log.warning("goflow2 exited with %s, restarting", await proc.wait())
        await flush()
        await asyncio.sleep(3)
    for t in tasks:
        t.cancel()


if __name__ == "__main__":
    asyncio.run(run())
