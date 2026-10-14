"""Runs the real ClickHouse SQL of the flow analytics and the detector against the embedded engine (chdb)."""
import asyncio
import datetime as dt
import tempfile
import time

import pytest

chdb = pytest.importorskip("chdb")
from chfake import ChdbClient  # noqa: E402

from app.db.models import FlowRule  # noqa: E402
from app.domain.models import Severity  # noqa: E402
from app.services.detector import KINDS, Detector  # noqa: E402
from app.services.flows import FlowSchema, FlowService, parse_blocklist  # noqa: E402

LEGACY = """CREATE TABLE flows.flows (TimeReceived DateTime, Direction Enum8('out' = 1, 'in' = 2),
 Route Enum8('direct' = 1, 'vpn' = 2), LocalAddr IPv4, RemoteAddr IPv4, Proto UInt8, LocalPort UInt16, RemotePort UInt16,
 RemoteAS UInt32, RemoteASName LowCardinality(String), RemoteCountry LowCardinality(String), Bytes UInt64, Packets UInt64,
 Flows UInt32 DEFAULT 1) ENGINE = MergeTree PARTITION BY toYYYYMMDD(TimeReceived) ORDER BY (TimeReceived, Direction, Route)"""


class Alerts:
    def __init__(self):
        self.raised, self.resolved = {}, []

    async def raise_(self, key, severity, title, message="", target_id="", link=""):
        self.raised[key] = (title, message, link)

    async def resolve(self, key):
        self.resolved.append(key)


def flow(t, **kw):
    base = {"TimeReceived": t, "Direction": "out", "Route": "direct", "LocalAddr": "192.168.0.10",
            "RemoteAddr": "8.8.8.8", "Proto": 6, "LocalPort": 50000, "RemotePort": 443, "RemoteAS": 15169,
            "RemoteASName": "GOOGLE", "RemoteCountry": "US", "Bytes": 1_000_000, "Packets": 1000, "Flows": 1,
            "ExporterAddress": "192.168.0.1", "InIf": 2, "OutIf": 1, "TCPFlags": 24, "SamplingRate": 1}
    base.update(kw)
    return base


@pytest.fixture(scope="module")
def env():
    async def setup():
        ch = ChdbClient(tempfile.mkdtemp())
        await ch.command("CREATE DATABASE IF NOT EXISTS flows", database="default")
        await ch.command(LEGACY, database="default")
        await ch.insert("flows", [{k: v for k, v in flow(int(time.time()) - 7200).items()
                                   if k not in ("ExporterAddress", "InIf", "OutIf", "TCPFlags", "SamplingRate")}])
        await FlowSchema(ch).ensure(30)
        now = int(time.time())
        rows = [flow(now - i * 10) for i in range(30)]
        rows += [flow(now - i, Direction="in", LocalAddr="192.168.0.20", RemoteAddr=f"203.0.113.{i}", RemotePort=40000 + i,
                      LocalPort=80, Proto=6, TCPFlags=2, Bytes=50_000_000, Packets=100_000) for i in range(40)]
        rows += [flow(now - 5, Direction="internal", LocalAddr="192.168.0.10", RemoteAddr="192.168.0.30", RemoteAS=0,
                      RemoteASName="", RemoteCountry="")]
        rows += [flow(now - 7, Direction="in", LocalAddr="192.168.0.40", RemoteAddr="198.51.100.7", LocalPort=p,
                      RemotePort=55555, Bytes=60, Packets=1, TCPFlags=2) for p in range(1, 21)]
        rows += [flow(now - 3, RemoteAddr="185.0.0.5", RemotePort=4444, LocalAddr="192.168.0.11")]
        rows += [flow(now - 4000, ExporterAddress="10.0.0.9")]
        await ch.insert("flows", rows)
        svc = FlowService(ch, None, None)
        await svc.sync_enrichment({"192.168.0.1": {"id": "x", "name": "core-router", "interfaces": [(1, "ether1-wan", 1000), (2, "bridge", 1)]}},
                                  [{"ip": "192.168.0.10", "name": "laptop", "mac": "aa:bb:cc:dd:ee:ff"}], ["10.10.0.0/24"])
        await ch.command("INSERT INTO flows.threat_prefixes VALUES ('185.0.0.0/24', 'firehol_level1')")
        await ch.command("SYSTEM RELOAD DICTIONARY flows.threats")
        return ch, svc
    return asyncio.run(setup())


def run(coro):
    return asyncio.run(coro)


def test_migrated_columns_and_aggregates(env):
    ch, _ = env
    cols = {r["name"]: r["type"] for r in run(ch.query("SELECT name, type FROM system.columns WHERE database = 'flows' AND table = 'flows'"))}
    assert "internal" in cols["Direction"] and cols["ServicePort"] == "UInt16"
    n = run(ch.query("SELECT count() AS n FROM flows.flows_5m"))[0]["n"]
    assert int(n) > 0
    sp = run(ch.query("SELECT ServicePort FROM flows.flows WHERE LocalPort = 50000 LIMIT 1"))[0]["ServicePort"]
    assert int(sp) == 443


def test_overview_and_records(env):
    _, svc = env
    o = run(svc.overview())
    assert o["widgets"]["app"][0]["name"] in ("HTTPS", "HTTP")
    assert any(w["name"] == "laptop" for w in o["widgets"]["device"])
    assert o["widgets"]["threat"][0]["name"] == "firehol_level1"
    rec = run(svc.recent("Application = HTTPS AND InIfName = bridge", 10))
    assert rec and rec[0]["Exporter"] == "core-router" and rec[0]["InIfName"] == "bridge"


@pytest.mark.parametrize("dims,graph,hours", [(["Application"], "stacked", 6), (["LocalHost", "RemoteCountry"], "sankey", 6),
                                              (["ExporterName", "OutIfName"], "lines", 72), (["Threat"], "grid", 1),
                                              (["RemoteAddr"], "stacked", 240)])
def test_visualize(env, dims, graph, hours):
    _, svc = env
    end = dt.datetime.now(dt.timezone.utc)
    r = run(svc.visualize({"start": (end - dt.timedelta(hours=hours)).isoformat(), "end": end.isoformat(),
                           "dimensions": dims, "graph": graph, "bidirectional": graph == "lines", "previousPeriod": True}))
    assert r["graph"] == graph
    if dims == ["ExporterName", "OutIfName"]:
        assert r["table"] == "flows_5m"
    if dims == ["RemoteAddr"]:
        assert r["table"] == "flows"


def test_exporters_and_traffic(env):
    _, svc = env
    ex = run(svc.exporters())
    core = next(e for e in ex if e["address"] == "192.168.0.1")
    assert core["name"] == "core-router" and any(i["name"] == "ether1-wan" for i in core["interfaces"])
    lt = run(svc.local_traffic(300))
    assert any(r["ip"] == "192.168.0.20" and r["in_bps"] > 0 for r in lt)
    assert run(svc.threat_contacts(1))[0]["list"] == "firehol_level1"


@pytest.mark.parametrize("kind", list(KINDS))
def test_detector_kinds(env, kind):
    ch, _ = env
    det = Detector(ch, None, Alerts(), None)
    params = det._validate({"kind": kind, "params": {"threshold": 1000, "pps": 100, "bps": 1000, "ports": 5,
                                                     "hosts": 5, "percent": 1, "minutes": 10, "min_bps": 0}})["params"]
    rule = FlowRule(id=1, name="t", kind=kind, filter="", severity=Severity.WARNING, params=params, state={})
    groups = run(det.evaluate(rule))
    expect = {"threshold": True, "ddos_volumetric": True, "ddos_syn": True, "scan": True, "exporter_silent": True,
              "threat_contact": True, "link_utilization": True}
    if expect.get(kind):
        assert groups, kind
    state = run(det._transition(rule, groups))
    assert set(state["firing"]) == set(groups)


def test_blocklist_parser():
    text = "# c\n1.2.3.0/24\n; x\n{\"cidr\":\"5.6.7.0/24\",\"sblid\":\"x\"}\n10.0.0.0/8 ; private\nbad\n2001:db8::/32\n"
    assert [str(n) for n in parse_blocklist(text)] == ["1.2.3.0/24", "5.6.7.0/24", "10.0.0.0/8"]
