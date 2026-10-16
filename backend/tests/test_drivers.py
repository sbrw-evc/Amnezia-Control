"""CLI parsers and HTTP drivers against captured-style device output."""
import asyncio
import json

import httpx
import pytest

from app.adapters.devices import PLATFORMS, platform
from app.adapters.devices.appliances import KeeneticDriver, parse_linux
from app.adapters.devices.base import Credentials, Target, norm_mac, validate_action
from app.adapters.devices.mikrotik import MikrotikDriver
from app.adapters.devices.parsers import (parse_arp, parse_cdp_detail, parse_lldp_detail, parse_lldp_table,
                                          parse_mac_table, parse_show_interfaces, parse_status_table, parse_uptime,
                                          parse_version)
from app.domain.errors import DomainError

IOS_VERSION = """Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4, RELEASE SOFTWARE (fc2)
core-sw uptime is 1 year, 2 weeks, 3 days, 4 hours, 5 minutes
System returned to ROM by power-on
cisco WS-C2960X-48TS-L (APM86XXX) processor (revision B0) with 524288K bytes of memory.
Base ethernet MAC Address       : 70:10:5C:11:22:33
Model number                    : WS-C2960X-48TS-L
System serial number            : FOC1234X0AB
"""
IOS_INTERFACES = """GigabitEthernet1/0/1 is up, line protocol is up (connected)
  Hardware is Gigabit Ethernet, address is 7010.5c11.2201 (bia 7010.5c11.2201)
  Description: uplink to gw
  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec,
     1234 packets input, 567890 bytes, 0 no buffer
     4321 packets output, 987654 bytes, 0 underruns
GigabitEthernet1/0/2 is administratively down, line protocol is down (disabled)
  Hardware is Gigabit Ethernet, address is 7010.5c11.2202 (bia 7010.5c11.2202)
  MTU 1500 bytes, BW 10000 Kbit/sec, DLY 1000 usec,
Vlan1 is up, line protocol is up
  Hardware is EtherSVI, address is 7010.5c11.2240 (bia 7010.5c11.2240)
  Internet address is 192.168.0.2/24
"""
CDP = """-------------------------
Device ID: ap-hall.local
Entry address(es):
  IP address: 192.168.0.40
Platform: cisco AIR-AP2802I-E-K9,  Capabilities: Router Trans-Bridge
Interface: GigabitEthernet1/0/5,  Port ID (outgoing port): GigabitEthernet0
"""
LLDP = """------------------------------------------------
Local Intf: Gi1/0/1
Chassis id: 000c.4200.0001
Port id: ether2
Port Description: ether2
System Name: gw

System Description:
MikroTik RouterOS 7.14

Management Addresses:
    IP: 192.168.0.1
"""
COMWARE_LLDP = """System Name        Local Interface  Chassis ID      Port ID
core-sw            GE1/0/24         7010-5c11-2233  GigabitEthernet1/0/48
"""
ARP_IOS = """Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.0.1             5   000c.4200.0001  ARPA   Vlan1
Internet  192.168.0.50            0   1122.3344.5566  ARPA   Vlan1
"""
ARP_COMWARE = """IP address      MAC address    VLAN/VSI name Interface                Aging Type
192.168.0.60    aabb-ccdd-eeff 1             GE1/0/3                  20    D
"""
MAC_IOS = """          Mac Address Table
-------------------------------------------
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
  10    1122.3344.5566    DYNAMIC     Gi1/0/5
   1    000c.4200.0001    DYNAMIC     Gi1/0/1
 All    0100.0ccc.cccc    STATIC      CPU
"""
STATUS = """Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   uplink             connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/2                      disabled     1            auto   auto 10/100/1000BaseTX
Gi1/0/3                      notconnect   1            auto   auto 10/100/1000BaseTX
"""
COMWARE_BRIEF = """Brief information on interfaces in bridge mode:
Link: ADM - administratively down; Stby - standby
Interface            Link   Speed   Duplex Type PVID Description
GE1/0/1              UP     1G(a)   F(a)   A    1
GE1/0/2              DOWN   auto    A      A    1
GE1/0/3              ADM    auto    A      A    1
"""


def test_cisco_parsers():
    v = parse_version(IOS_VERSION)
    assert v["hostname"] == "core-sw" and v["version"] == "15.2(7)E4" and v["model"] == "WS-C2960X-48TS-L"
    assert v["serial"] == "FOC1234X0AB" and v["mac"] == "70:10:5c:11:22:33"
    assert v["uptime_seconds"] == 31536000 + 2 * 604800 + 3 * 86400 + 4 * 3600 + 5 * 60
    ifs = parse_show_interfaces(IOS_INTERFACES)
    assert [i.name for i in ifs] == ["GigabitEthernet1/0/1", "GigabitEthernet1/0/2", "Vlan1"]
    g1 = ifs[0]
    assert g1.oper_up and g1.admin_up and g1.speed_mbps == 1000 and g1.rx_bytes == 567890 and g1.tx_bytes == 987654
    assert g1.description == "uplink to gw" and g1.mac == "70:10:5c:11:22:01"
    assert not ifs[1].admin_up and ifs[2].addresses == ["192.168.0.2/24"]
    cdp = parse_cdp_detail(CDP)
    assert cdp[0].remote_name == "ap-hall.local" and cdp[0].remote_ip == "192.168.0.40" and cdp[0].local_interface == "GigabitEthernet1/0/5"
    lldp = parse_lldp_detail(LLDP)
    assert lldp[0].local_interface == "Gi1/0/1" and lldp[0].remote_mac == "00:0c:42:00:00:01"
    assert lldp[0].remote_name == "gw" and lldp[0].remote_ip == "192.168.0.1"
    arp = parse_arp(ARP_IOS)
    assert [(e.ip, e.mac, e.interface) for e in arp] == [("192.168.0.1", "00:0c:42:00:00:01", "Vlan1"),
                                                        ("192.168.0.50", "11:22:33:44:55:66", "Vlan1")]
    macs = parse_mac_table(MAC_IOS, uplinks={"Gi1/0/1"})
    assert [(e.mac, e.vlan, e.interface) for e in macs] == [("11:22:33:44:55:66", 10, "Gi1/0/5")]
    st = parse_status_table(STATUS)
    assert [(i.name, i.oper_up, i.admin_up, i.speed_mbps) for i in st] == [
        ("Gi1/0/1", True, True, 1000), ("Gi1/0/2", False, False, None), ("Gi1/0/3", False, True, None)]


def test_comware_parsers():
    st = parse_status_table(COMWARE_BRIEF)
    assert [(i.name, i.oper_up, i.admin_up) for i in st] == [("GE1/0/1", True, True), ("GE1/0/2", False, True),
                                                            ("GE1/0/3", False, False)]
    assert st[0].speed_mbps == 1000
    nb = parse_lldp_table(COMWARE_LLDP)
    assert nb[0].remote_name == "core-sw" and nb[0].local_interface == "GE1/0/24" and nb[0].remote_mac == "70:10:5c:11:22:33"
    arp = parse_arp(ARP_COMWARE)
    assert arp[0].ip == "192.168.0.60" and arp[0].interface == "GE1/0/3"


def test_misc_helpers():
    assert parse_uptime("10 days, 03:04:05") == 10 * 86400 + 3 * 3600 + 4 * 60 + 5
    assert norm_mac("AABB.CCDD.EEFF") == "aa:bb:cc:dd:ee:ff" and norm_mac("x") == ""
    with pytest.raises(DomainError):
        validate_action("hostname", {"name": "bad name; reload"})
    with pytest.raises(DomainError):
        validate_action("interface", {"name": "ether1", "description": "a\"; /system reset"})
    assert validate_action("dns", {"servers": ["1.1.1.1", " dns.google "]})["servers"] == ["1.1.1.1", "dns.google"]
    p = validate_action("flow_export", {"collector": "192.168.0.210"})
    assert p["port"] == 2055 and p["protocol"] == "netflow9"


LINUX = """#HOST
openwrt
#OS
NAME="OpenWrt"
VERSION_ID="23.05.3"
#UPTIME
3600.50 1000.00
#MODEL
GL.iNet GL-MT6000
#MEM
MemTotal:        1000000 kB
MemFree:          400000 kB
MemAvailable:     500000 kB
#LOAD
0.50 0.40 0.30 1/100 1234
4
#LINK
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000\\    link/ether 94:83:c4:00:00:01 brd ff:ff:ff:ff:ff:ff
3: br-lan: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000\\    link/ether 94:83:c4:00:00:02 brd ff:ff:ff:ff:ff:ff
#ADDR
3: br-lan    inet 192.168.8.1/24 brd 192.168.8.255 scope global br-lan\\       valid_lft forever preferred_lft forever
#DEV
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:     100       1    0    0    0     0          0         0      100       1    0    0    0     0       0          0
  eth0: 5000000   4000    0    0    0     0          0         0  6000000    5000    0    0    0     0       0          0
br-lan: 3000000   2000    0    0    0     0          0         0  2000000    1000    0    0    0     0       0          0
#SPEED
/sys/class/net/eth0/speed 1000
/sys/class/net/br-lan/speed -1
#ARP
IP address       HW type     Flags       HW address            Mask     Device
192.168.8.120    0x1         0x2         3c:22:fb:00:00:01     *        br-lan
192.168.8.121    0x1         0x0         00:00:00:00:00:00     *        br-lan
#LEASES
1700000000 3c:22:fb:00:00:01 192.168.8.120 MacBook 01:3c:22:fb:00:00:01
1700000000 e4:5f:01:00:00:02 192.168.8.130 * *
#LLDP
"""


def test_linux_parser():
    s = parse_linux(LINUX)
    assert s.facts.hostname == "openwrt" and s.facts.version == "23.05.3" and s.facts.model == "GL.iNet GL-MT6000"
    assert s.facts.uptime_seconds == 3600 and s.facts.memory_percent == 50.0 and s.facts.cpu_percent == 12.5
    eth0 = next(i for i in s.interfaces if i.name == "eth0")
    assert eth0.speed_mbps == 1000 and eth0.rx_bytes == 5000000 and eth0.tx_bytes == 6000000 and eth0.oper_up
    assert next(i for i in s.interfaces if i.name == "br-lan").addresses == ["192.168.8.1/24"]
    assert {(e.mac, e.source) for e in s.endpoints} == {("3c:22:fb:00:00:01", "arp"), ("3c:22:fb:00:00:01", "dhcp"),
                                                        ("e4:5f:01:00:00:02", "dhcp")}


def mock(handler):
    return httpx.MockTransport(handler)


def test_mikrotik_rest():
    data = {
        "system/resource": {"uptime": "1w2d03:04:05", "cpu-load": "7", "total-memory": "1000", "free-memory": "250",
                            "version": "7.14.2 (stable)", "board-name": "RB5009"},
        "system/identity": {"name": "gw"}, "system/routerboard": {"model": "RB5009UG+S+", "serial-number": "HE1234"},
        "ip/address": [{"address": "192.168.0.1/24", "interface": "bridge", "disabled": "false"}],
        "interface": [{"name": "ether1", "type": "ether", "mac-address": "00:0C:42:00:00:01", "running": "true",
                       "disabled": "false", "rx-byte": "100", "tx-byte": "200"},
                      {"name": "bridge", "type": "bridge", "mac-address": "00:0C:42:00:00:09", "running": "true",
                       "disabled": "false"}],
        "ip/neighbor": [{"interface": "ether2", "identity": "sw1", "mac-address": "AA:00:00:00:00:01",
                         "address": "192.168.0.2", "discovered-by": "lldp,mndp"}],
        "ip/arp": [{"address": "192.168.0.50", "mac-address": "11:22:33:44:55:66", "interface": "bridge"}],
        "ip/dhcp-server/lease": [{"address": "192.168.0.50", "mac-address": "11:22:33:44:55:66", "host-name": "tv"}],
        "interface/bridge/host": [{"mac-address": "11:22:33:44:55:66", "on-interface": "ether3", "local": "false"},
                                  {"mac-address": "AA:00:00:00:00:01", "on-interface": "ether2", "local": "false"}],
    }
    calls = []

    def handler(req: httpx.Request):
        path = req.url.path.removeprefix("/rest/")
        calls.append((req.method, path, req.content))
        if req.method == "POST" and path == "execute":
            return httpx.Response(200, json={"ret": ""})
        if path in data:
            return httpx.Response(200, json=data[path])
        return httpx.Response(404, json={"error": 404})

    async def go():
        d = MikrotikDriver(Target("192.0.2.1", transport="api"), Credentials(username="u", password="p"), "MikroTik")
        d._http = httpx.AsyncClient(base_url="https://192.0.2.1", transport=mock(handler))
        snap = await d.collect()
        assert snap.facts.hostname == "gw" and snap.facts.model == "RB5009UG+S+" and snap.facts.version == "7.14.2"
        assert snap.facts.uptime_seconds == 9 * 86400 + 3 * 3600 + 4 * 60 + 5 and snap.facts.memory_percent == 75.0
        assert snap.interfaces[1].addresses == ["192.168.0.1/24"] and snap.interfaces[0].rx_bytes == 100
        assert snap.neighbors[0].protocol == "lldp" and snap.neighbors[0].remote_mac == "aa:00:00:00:00:01"
        bridge = [e for e in snap.endpoints if e.source == "bridge"]
        assert [(e.mac, e.interface) for e in bridge] == [("11:22:33:44:55:66", "ether3")]
        await d.apply("flow_export", validate_action("flow_export", {"collector": "192.168.0.210"}))
        script = json.loads(calls[-1][2])["script"]
        assert "traffic-flow target add dst-address=192.168.0.210 port=2055 version=9" in script
        await d.apply("interface", validate_action("interface", {"name": "ether5", "enabled": False, "description": "tv"}))
        assert json.loads(calls[-1][2])["script"] == '/interface set [find name="ether5"] disabled=yes comment="tv"'
    asyncio.run(go())


def test_keenetic_auth_and_parse():
    import hashlib
    state = {"auth": False, "posted": []}

    def handler(req: httpx.Request):
        if req.url.path == "/auth" and req.method == "GET":
            return httpx.Response(401, headers={"X-NDM-Realm": "Keenetic", "X-NDM-Challenge": "CH"})
        if req.url.path == "/auth" and req.method == "POST":
            body = json.loads(req.content)
            md5 = hashlib.md5(b"admin:Keenetic:pw").hexdigest()
            ok = body["password"] == hashlib.sha256(("CH" + md5).encode()).hexdigest()
            state["auth"] = ok
            return httpx.Response(200 if ok else 401, headers={"Set-Cookie": "session=1; Path=/"})
        assert state["auth"]
        if req.url.path == "/rci/show/version":
            return httpx.Response(200, json={"model": "Keenetic Giga", "release": "4.1.1"})
        if req.url.path == "/rci/show/system":
            return httpx.Response(200, json={"hostname": "home", "uptime": "100", "cpuload": 5, "memory": "50/200"})
        if req.url.path == "/rci/show/interface":
            return httpx.Response(200, json={"GigabitEthernet1": {"id": "GigabitEthernet1", "type": "GigabitEthernet",
                                                                  "link": "up", "state": "up", "mac": "50:ff:20:00:00:01"}})
        if req.url.path == "/rci/show/ip/hotspot":
            return httpx.Response(200, json={"host": [{"mac": "3c:22:fb:00:00:01", "ip": "192.168.1.33", "name": "Mac",
                                                       "ssid": "Home", "rssi": -48, "access": "permit"}]})
        if req.url.path == "/rci/":
            state["posted"].append(json.loads(req.content))
            return httpx.Response(200, json=[{"parse": {"status": [{"status": "message"}]}}])
        return httpx.Response(404)

    async def go():
        d = KeeneticDriver(Target("192.0.2.5", transport="http"), Credentials(username="admin", password="pw"), "Keenetic")
        d.http = httpx.AsyncClient(base_url="http://192.0.2.5", transport=mock(handler))
        snap = await d.collect()
        assert snap.facts.model == "Keenetic Giga" and snap.facts.memory_percent == 25.0
        assert snap.endpoints[0].source == "wifi" and snap.endpoints[0].signal == -48
        await d.apply("endpoint_block", validate_action("endpoint_block", {"mac": "3C:22:FB:00:00:01"}))
        assert state["posted"][-1][0]["parse"] == "ip hotspot host 3c:22:fb:00:00:01 deny"
    asyncio.run(go())


def test_registry_covers_requested_brands():
    vendors = " ".join(f"{p.vendor} {p.title}" for p in PLATFORMS.values()).lower()
    for brand in ("tp-link", "omada", "mikrotik", "opnsense", "routeros", "pfsense", "openwrt", "keenetic", "cisco",
                  "unifi", "zyxel", "hp", "dell", "juniper", "huawei", "fortinet", "eltex", "netgear", "d-link", "meraki"):
        assert brand in vendors, brand
    for key, p in PLATFORMS.items():
        for t in p.transports:
            assert p.driver(Target("192.0.2.1", transport=t), Credentials()).capabilities is not None
    assert platform("cisco_ios").capabilities("ssh")[:2] == ["hostname", "interface"]
