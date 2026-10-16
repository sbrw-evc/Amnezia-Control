"""Device registry, polling, endpoint merging and the network map against a real PostgreSQL
(TEST_DATABASE_URL, e.g. postgresql+asyncpg://user@127.0.0.1:55432/db)."""
import asyncio
import os

import pytest

from app.adapters.devices import PLATFORMS, Platform
from app.adapters.devices.base import Child, DeviceDriver, Endpoint, Facts, Interface, Neighbor, Snapshot
from app.adapters.oui import OuiDatabase
from app.db.base import Database
from app.db.models import Base
from app.services.audit import AuditService
from app.services.common import Actor, EventBus
from app.services.devices import DeviceService
from app.services.settings import SettingsService
from app.services.topology import TopologyService

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL is not set")
ADMIN = Actor("admin", "admin")

SNAPS = {
    "router": Snapshot(Facts(hostname="gw", mac="00:0c:42:00:00:01", model="RB5009"),
                       [Interface("ether1", mac="00:0c:42:00:00:01", rx_bytes=1000, tx_bytes=1000, speed_mbps=1000,
                                  addresses=["192.168.0.1/24"]),
                        Interface("ether2", mac="00:0c:42:00:00:02", rx_bytes=0, tx_bytes=0)],
                       [Neighbor("ether2", remote_name="sw1", remote_mac="aa:00:00:00:00:01", remote_interface="Gi0/1")],
                       [Endpoint("11:22:33:44:55:66", ip="192.168.0.50", interface="bridge", source="arp"),
                        Endpoint("11:22:33:44:55:66", ip="192.168.0.50", hostname="tv", source="dhcp"),
                        Endpoint("22:22:33:44:55:66", ip="192.168.0.51", hostname="phone", source="dhcp")]),
    "switch": Snapshot(Facts(hostname="sw1", mac="aa:00:00:00:00:01"),
                       [Interface("Gi0/1", mac="aa:00:00:00:00:01"), Interface("Gi0/5")],
                       [Neighbor("Gi0/1", remote_name="gw", remote_mac="00:0c:42:00:00:01", remote_interface="ether2")],
                       [Endpoint("11:22:33:44:55:66", interface="Gi0/5", source="bridge", vlan=10)]),
    "ctl": Snapshot(Facts(hostname="Omada"), [], [],
                    [Endpoint("22:22:33:44:55:66", ip="192.168.0.51", hostname="phone", source="controller",
                              ssid="Home", signal=-50, attached_to="bb:00:00:00:00:01")],
                    [Child("bb:00:00:00:00:01", name="ap-hall", kind="ap", uplink_mac="aa:00:00:00:00:01", uplink_port="Gi0/8")]),
}


class FakeDriver(DeviceDriver):
    capabilities = frozenset({"hostname", "endpoint_block"})
    applied: list = []

    async def collect(self):
        return SNAPS[self.target.host]

    async def apply(self, action, p):
        FakeDriver.applied.append((self.target.host, action, p))
        return "ok"


class Secrets:
    def __init__(self):
        self.d = {}

    async def get(self, path):
        return self.d.get(path)

    async def put(self, path, data):
        self.d[path] = data

    async def delete(self, path):
        self.d.pop(path, None)


class Alerts:
    def __init__(self):
        self.raised = {}

    async def raise_(self, key, *a, **kw):
        self.raised[key] = a

    async def resolve(self, key):
        self.raised.pop(key, None)


@pytest.fixture
def svc():
    PLATFORMS["fake"] = Platform("fake", "Fake", "Fake", "any", "router", {"api": 1}, ("password",), FakeDriver)

    async def setup():
        db = Database(URL)
        async with db.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await db.create_schema()
        bus = EventBus()
        settings = SettingsService(db)
        return db, DeviceService(db, Secrets(), AuditService(db, bus), Alerts(), bus, settings, OuiDatabase("/tmp"),
                                 {"collector_host": "192.168.0.210"}), settings
    yield setup
    PLATFORMS.pop("fake", None)


def test_poll_merge_and_topology(svc):
    async def scenario():
        db, devices, settings = await svc()
        ids = {}
        for host, role in (("router", "router"), ("switch", "switch"), ("ctl", "controller")):
            d = await devices.create(ADMIN, {"platform": "fake", "host": host, "role": role,
                                             "credentials": {"password": "secret"}})
            ids[host] = d["id"]
            assert d["credentials"] == {"password": True}
        await asyncio.sleep(0.3)  # creation polls in the background
        for i in ids.values():
            await devices.poll(i)
        eps = {e["mac"]: e for e in await devices.endpoints()}
        tv, phone = eps["11:22:33:44:55:66"], eps["22:22:33:44:55:66"]
        assert tv["source"] == "bridge" and tv["device_id"] == ids["switch"] and tv["hostname"] == "tv" and tv["vlan"] == 10
        assert phone["source"] == "controller" and phone["attached_to"] == "bb:00:00:00:00:01" and phone["online"]
        router = await devices.get(ids["router"])
        assert router["name"] == "gw" and router["status"] == "up"
        assert router["interfaces"][0]["rx_bps"] is not None
        topo = await TopologyService(db, settings, None, {"vpn_host": "203.0.113.10", "router_host": "router"}).build()
        edges = {(e["source"], e["target"], e["kind"]) for e in topo["edges"]}
        r, s = f"dev:{ids['router']}", f"dev:{ids['switch']}"
        assert any({a, b} == {r, s} and k == "link" for a, b, k in edges)
        assert (s, "mac:bb:00:00:00:00:01", "link") in edges or ("mac:bb:00:00:00:00:01", s, "link") in edges
        assert ("mac:bb:00:00:00:00:01", "ep:22:22:33:44:55:66", "wifi") in edges
        assert (s, "ep:11:22:33:44:55:66", "wired") in edges
        assert ("internet", r, "wan") in edges and (r, "vpn", "tunnel") in edges
        res = await devices.block_endpoint(ADMIN, "22:22:33:44:55:66", True)
        assert res["ok"] and FakeDriver.applied[-1][:2] == ("ctl", "endpoint_block")
        await devices.update(ADMIN, ids["router"], {"credentials": {"username": "admin"}, "clear_credentials": ["password"]})
        assert (await devices.get(ids["router"]))["credentials"] == {"username": "admin"}
        exp = await devices.exporter_map()
        assert exp["192.168.0.1"]["name"] == "gw"
        assert "192.168.0.0/24" in await devices.local_networks()
        await devices.delete(ADMIN, ids["ctl"])
        assert len(await devices.list()) == 2
        await db.engine.dispose()

    asyncio.run(scenario())
