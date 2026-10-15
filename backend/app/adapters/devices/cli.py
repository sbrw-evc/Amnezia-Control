"""SSH CLI drivers of switch / router families. A profile lists the commands of one network OS; the parsers in
parsers.py turn the output into the common model."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable

from ...domain.errors import ExternalServiceError
from .base import (DeviceDriver, Endpoint, Facts, Interface, Neighbor, Snapshot, UnsupportedAction, norm_ip, norm_mac,
                   to_int)
from .parsers import (parse_arp, parse_uptime, parse_cdp_detail, parse_lldp_detail, parse_lldp_table, parse_mac_table,
                      parse_show_interfaces, parse_status_table, parse_version, shorten_iface)
from .transport import SshTransport

ERROR = re.compile(r"^\s*(%\s*(invalid|incomplete|ambiguous|unknown|unrecognized)|invalid input|unrecognized command|"
                   r"unknown command|error:|syntax error|command not found|\^$)", re.I | re.M)
Template = Callable[[dict], list[str]]


def _quote(s: str) -> str:
    return '"' + s.replace('"', "") + '"'


def _cisco_iface(p: dict) -> list[str]:
    cmds = [f"interface {p['name']}"]
    if p.get("enabled") is not None:
        cmds.append("no shutdown" if p["enabled"] else "shutdown")
    if p.get("description") is not None:
        cmds.append(f"description {p['description']}" if p["description"] else "no description")
    return cmds + ["exit"]


def _ios_flow(p: dict) -> list[str]:
    if not p["enabled"]:
        return ["no flow exporter NC-EXPORT"]
    if p["protocol"] == "sflow":
        raise ValueError("sflow")
    proto = {"netflow9": "netflow-v9", "ipfix": "ipfix", "netflow5": "netflow-v5"}[p["protocol"]]
    cmds = ["flow exporter NC-EXPORT", f" destination {p['collector']}", f" transport udp {p['port']}",
            f" export-protocol {proto}", " template data timeout 60", "exit",
            "flow monitor NC-MONITOR", " exporter NC-EXPORT", " record netflow ipv4 original-input",
            " cache timeout active 60", "exit",
            "flow monitor NC-MONITOR6", " exporter NC-EXPORT", " record netflow ipv6 original-input",
            " cache timeout active 60", "exit"]
    for i in p.get("interfaces") or []:
        cmds += [f"interface {i}", " ip flow monitor NC-MONITOR input", " ipv6 flow monitor NC-MONITOR6 input", "exit"]
    return cmds


def _aruba_iface(p: dict) -> list[str]:
    cmds = [f"interface {p['name']}"]
    if p.get("enabled") is not None:
        cmds.append("enable" if p["enabled"] else "disable")
    if p.get("description") is not None:
        cmds.append(f"name {_quote(p['description'])}" if p["description"] else "no name")
    return cmds + ["exit"]


def _comware_iface(p: dict) -> list[str]:
    cmds = [f"interface {p['name']}"]
    if p.get("enabled") is not None:
        cmds.append("undo shutdown" if p["enabled"] else "shutdown")
    if p.get("description") is not None:
        cmds.append(f"description {p['description']}" if p["description"] else "undo description")
    return cmds + ["quit"]


@dataclass(frozen=True)
class CliProfile:
    key: str
    vendor: str
    os: str
    setup: tuple[str, ...] = ("terminal length 0",)
    version: tuple[str, ...] = ("show version",)
    interfaces: tuple[str, ...] = ("show interfaces", "show interfaces status")
    lldp: tuple[str, ...] = ("show lldp neighbors detail",)
    cdp: tuple[str, ...] = ()
    arp: tuple[str, ...] = ("show ip arp", "show arp")
    mac: tuple[str, ...] = ("show mac address-table",)
    running: str = "show running-config"
    enter: tuple[str, ...] = ("configure terminal",)
    leave: tuple[str, ...] = ("end",)
    save: tuple[str, ...] = ("write memory",)
    reboot: tuple[str, ...] = ()
    templates: dict[str, Template] = field(default_factory=dict)
    legacy_ssh: bool = False
    answers: dict[str, str] = field(default_factory=lambda: {r"\[confirm\]\s*$": "", r"\[y/n\]:?\s*$": "y",
                                                               r"\[yes/no\]:?\s*$": "yes",
                                                               r"destination filename \[.*\]\?\s*$": ""})


CISCO_LIKE = {
    "hostname": lambda p: [f"hostname {p['name']}"],
    "interface": _cisco_iface,
    "dns": lambda p: [f"ip name-server {' '.join(p['servers'])}"],
    "ntp": lambda p: [f"ntp server {s}" for s in p["servers"]],
}

PROFILES: dict[str, CliProfile] = {p.key: p for p in (
    CliProfile("cisco_ios", "Cisco", "IOS / IOS-XE", cdp=("show cdp neighbors detail",),
               templates={**CISCO_LIKE, "flow_export": _ios_flow}, reboot=("reload",), legacy_ssh=True),
    CliProfile("cisco_nxos", "Cisco", "NX-OS", interfaces=("show interface", "show interface brief"),
               cdp=("show cdp neighbors detail",), save=("copy running-config startup-config",),
               templates={**CISCO_LIKE, "dns": lambda p: [f"ip name-server {' '.join(p['servers'])}"],
                          "ntp": lambda p: [f"ntp server {s} use-vrf management" for s in p["servers"]]},
               reboot=("reload",)),
    CliProfile("dell_os10", "Dell", "OS10", interfaces=("show interface", "show interface status"),
               arp=("show ip arp",), templates=CISCO_LIKE, reboot=("reload",)),
    CliProfile("dell_nseries", "Dell", "PowerSwitch N / PowerConnect", setup=("terminal length 0",),
               interfaces=("show interfaces status", "show interfaces"), lldp=("show lldp remote-device detail all",
                                                                              "show lldp remote-device all"),
               arp=("show arp",), templates=CISCO_LIKE, reboot=("reload",), legacy_ssh=True),
    CliProfile("aruba_cx", "HPE Aruba", "AOS-CX", setup=("no page",), interfaces=("show interface", "show interface brief"),
               lldp=("show lldp neighbor-info detail", "show lldp neighbor-info"), arp=("show arp",),
               mac=("show mac-address-table",),
               templates={**CISCO_LIKE, "dns": lambda p: [f"ip dns server-address {s}" for s in p["servers"]]},
               reboot=("boot system",)),
    CliProfile("aruba_os", "HP / HPE Aruba", "ArubaOS-Switch / ProCurve", setup=("no page",),
               version=("show system", "show version"), interfaces=("show interfaces brief",),
               lldp=("show lldp info remote-device",), arp=("show arp",), mac=("show mac-address",),
               enter=("configure",), leave=("end",), save=("write memory",), reboot=("boot",), legacy_ssh=True,
               templates={"hostname": lambda p: [f"hostname {_quote(p['name'])}"], "interface": _aruba_iface,
                          "dns": lambda p: [f"ip dns server-address priority {i + 1} {s}" for i, s in enumerate(p["servers"][:3])],
                          "ntp": lambda p: ["timesync sntp", "sntp unicast"] + [f"sntp server priority {i + 1} {s}" for i, s in enumerate(p["servers"][:3])],
                          "flow_export": lambda p: ([f"sflow 1 destination {p['collector']} {p['port']}",
                                                     "sflow 1 sampling all 1024", "sflow 1 polling all 30"]
                                                    if p["enabled"] else ["no sflow 1 destination"])
                          if p["protocol"] == "sflow" else (_ for _ in ()).throw(ValueError("sflow"))}),
    CliProfile("hp_comware", "HPE / H3C", "Comware", setup=("screen-length disable",), version=("display version",),
               interfaces=("display interface brief",), lldp=("display lldp neighbor-information verbose",
                                                              "display lldp neighbor-information list"),
               arp=("display arp",), mac=("display mac-address",), running="display current-configuration",
               enter=("system-view",), leave=("return",), save=("save force",), reboot=("reboot",), legacy_ssh=True,
               templates={"hostname": lambda p: [f"sysname {p['name']}"], "interface": _comware_iface,
                          "dns": lambda p: [f"dns server {s}" for s in p["servers"]],
                          "ntp": lambda p: ["ntp-service enable"] + [f"ntp-service unicast-server {s}" for s in p["servers"]],
                          "flow_export": lambda p: ([f"sflow collector 1 ip {p['collector']} port {p['port']}"]
                                                    if p["enabled"] else ["undo sflow collector 1"])
                          if p["protocol"] == "sflow" else (_ for _ in ()).throw(ValueError("sflow"))}),
    CliProfile("huawei_vrp", "Huawei", "VRP", setup=("screen-length 0 temporary",), version=("display version",),
               interfaces=("display interface brief",), lldp=("display lldp neighbor", "display lldp neighbor brief"),
               arp=("display arp",), mac=("display mac-address",), running="display current-configuration",
               enter=("system-view",), leave=("return",), save=("save",), reboot=("reboot",), legacy_ssh=True,
               templates={"hostname": lambda p: [f"sysname {p['name']}"], "interface": _comware_iface,
                          "dns": lambda p: ["dns resolve"] + [f"dns server {s}" for s in p["servers"]],
                          "ntp": lambda p: [f"ntp-service unicast-server {s}" for s in p["servers"]]}),
    CliProfile("zyxel", "Zyxel", "Zyxel switch / ZLD", setup=(), version=("show system-information", "show version"),
               interfaces=("show interfaces status", "show interface all"),
               lldp=("show lldp info remote", "show lldp neighbor"), arp=("show ip arp", "show arp-table"),
               mac=("show mac address-table all",), enter=("configure",), leave=("exit",), save=("write memory",),
               reboot=("reload config",), legacy_ssh=True,
               templates={"hostname": lambda p: [f"hostname {p['name']}"], "interface": _cisco_iface,
                          "ntp": lambda p: ["time timezone 0", f"time ntp-server {p['servers'][0]}"]}),
    CliProfile("tplink_jetstream", "TP-Link", "JetStream / Omada switch (standalone)", setup=("enable",),
               version=("show system-info",), interfaces=("show interface status",),
               lldp=("show lldp neighbor-information interface",), arp=("show arp",),
               mac=("show mac address-table all",), enter=("configure",), leave=("end",),
               save=("copy running-config startup-config",), reboot=("reboot",), legacy_ssh=True,
               templates={"hostname": lambda p: [f"hostname {p['name']}"], "interface": _cisco_iface,
                          "ntp": lambda p: [f"system-time ntp UTC+00:00 {p['servers'][0]} "
                                            f"{p['servers'][1] if len(p['servers']) > 1 else p['servers'][0]} 12"]}),
    CliProfile("eltex", "Eltex", "MES", setup=("terminal datadump",), interfaces=("show interfaces status",),
               lldp=("show lldp neighbors",), arp=("show arp",), templates=CISCO_LIKE, reboot=("reload",),
               legacy_ssh=True),
)}


class CliDriver(DeviceDriver):
    default_transport = "ssh"

    def __init__(self, target, creds, vendor: str = "", profile: str = "cisco_ios"):
        super().__init__(target, creds, vendor)
        self.p = PROFILES[profile]
        self._ssh = SshTransport(target, creds, legacy=self.p.legacy_ssh)
        self.capabilities = frozenset(set(self.p.templates) | {"command", "backup"} | ({"reboot"} if self.p.reboot else set()))

    async def _session(self, commands: list[str], timeout: float = 60, answers: dict | None = None) -> list[str]:
        try:
            out = await self._ssh.shell(list(self.p.setup) + commands, timeout=timeout,
                                        enable=self.creds.enable_password, answers=answers)
        finally:
            if self._ssh.host_key:
                self.learned_host_key = self._ssh.host_key
        return out[len(self.p.setup):]

    @staticmethod
    def _ok(text: str) -> str:
        return "" if ERROR.search(text[:400]) else text

    async def collect(self) -> Snapshot:
        groups = [self.p.version, self.p.interfaces, self.p.lldp, self.p.cdp, self.p.arp, self.p.mac]
        flat = [c for g in groups for c in g]
        outs = dict(zip(flat, await self._session(flat)))

        def pick(cmds, parser):
            for c in cmds:
                text = self._ok(outs.get(c, ""))
                if text:
                    res = parser(text)
                    if res:
                        return res
            return []

        v = parse_version("\n".join(self._ok(outs.get(c, "")) for c in self.p.version))
        facts = Facts(hostname=v["hostname"], vendor=self.p.vendor, model=v["model"], os=self.p.os,
                      version=v["version"], serial=v["serial"], mac=v["mac"], uptime_seconds=v["uptime_seconds"])
        interfaces: list[Interface] = pick(self.p.interfaces, lambda t: parse_show_interfaces(t) or parse_status_table(t))
        neighbors: list[Neighbor] = pick(self.p.lldp, lambda t: parse_lldp_detail(t) or parse_lldp_table(t))
        seen = {(shorten_iface(n.local_interface), n.remote_name.lower()) for n in neighbors}
        for n in pick(self.p.cdp, parse_cdp_detail):
            if (shorten_iface(n.local_interface), n.remote_name.lower()) not in seen:
                neighbors.append(n)
        uplinks = {shorten_iface(n.local_interface) for n in neighbors} | {n.local_interface for n in neighbors}
        endpoints: list[Endpoint] = pick(self.p.arp, parse_arp) + pick(self.p.mac, lambda t: parse_mac_table(t, uplinks))
        if not facts.mac:
            facts.mac = next((i.mac for i in interfaces if i.mac), "")
        return Snapshot(facts, interfaces, neighbors, endpoints)

    async def apply(self, action: str, p: dict) -> str:
        if action == "command":
            return (await self._session([p["command"]], timeout=120))[0]
        if action == "reboot" and self.p.reboot:
            try:
                await self._session(list(self.p.save) + list(self.p.reboot), timeout=30, answers=self.p.answers)
            except ExternalServiceError:
                pass  # the device closes the session while rebooting
            return "Перезагрузка запущена"
        tpl = self.p.templates.get(action)
        if not tpl:
            raise UnsupportedAction(self.vendor or self.p.vendor, action)
        try:
            body = tpl(p)
        except ValueError:
            raise UnsupportedAction(self.vendor or self.p.vendor, f"{action} ({p.get('protocol')})")
        outs = await self._session(list(self.p.enter) + body + list(self.p.leave) + list(self.p.save),
                                   answers=self.p.answers)
        errors = [o.strip().splitlines()[0] for o in outs if ERROR.search(o)]
        if errors:
            raise ExternalServiceError(f"{self.target.host}: {errors[0]}")
        return "Готово"

    async def backup(self) -> str:
        return (await self._session([self.p.running], timeout=120))[0]

    async def close(self) -> None:
        await self._ssh.close()


class JunosDriver(DeviceDriver):
    """Juniper Junos (EX / SRX / MX / QFX): operational commands with `| display json` on an exec channel."""
    capabilities = frozenset({"hostname", "interface", "dns", "ntp", "reboot", "command", "backup"})
    default_transport = "ssh"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._ssh = SshTransport(self.target, self.creds)

    async def _json(self, cmd: str) -> dict:
        out = await self._ssh.run(f"{cmd} | display json | no-more", timeout=60)
        self.learned_host_key = self._ssh.host_key
        try:
            return json.loads(out[out.find("{"):]) if "{" in out else {}
        except ValueError:
            return {}

    @staticmethod
    def _d(node, *path, default=""):
        """Junos JSON wraps every value as [{"data": v}] / [{...}]."""
        for key in path:
            if isinstance(node, list):
                node = node[0] if node else {}
            if not isinstance(node, dict):
                return default
            node = node.get(key, default)
        if isinstance(node, list):
            node = node[0] if node else {}
        if isinstance(node, dict) and "data" in node:
            return node["data"]
        return node if node != {} else default

    async def collect(self) -> Snapshot:
        d = self._d
        info = await self._json("show system information")
        si = d(info, "system-information")
        up = await self._json("show system uptime")
        uptime = d(up, "system-uptime-information", "uptime-information", "up-time") or d(
            up, "multi-routing-engine-results", "multi-routing-engine-item", "system-uptime-information",
            "uptime-information", "up-time")
        facts = Facts(hostname=str(d(si, "host-name")), vendor="Juniper", model=str(d(si, "hardware-model")), os="Junos",
                      version=str(d(si, "os-version")), serial=str(d(si, "serial-number")),
                      uptime_seconds=parse_uptime(str(uptime)))
        interfaces = []
        ifs = await self._json("show interfaces extensive")
        for phy in (ifs.get("interface-information") or [{}])[0].get("physical-interface", []):
            name = d(phy, "name")
            stats = d(phy, "traffic-statistics", default={})
            speed = str(d(phy, "speed"))
            m = re.match(r"(\d+)\s*([mg])", speed.lower())
            interfaces.append(Interface(
                name=name, description=str(d(phy, "description")), mac=norm_mac(d(phy, "current-physical-address")),
                admin_up=str(d(phy, "admin-status")) == "up", oper_up=str(d(phy, "oper-status")) == "up",
                mtu=to_int(d(phy, "mtu"), None), speed_mbps=(int(m.group(1)) * (1000 if m.group(2) == "g" else 1)) if m else None,
                rx_bytes=to_int(d(stats, "input-bytes"), None) if stats else None,
                tx_bytes=to_int(d(stats, "output-bytes"), None) if stats else None,
                addresses=[str(d(a, "ifa-local")) + "/" + str(d(a, "ifa-destination")).split("/")[-1]
                           for lif in phy.get("logical-interface", []) for af in lif.get("address-family", [])
                           for a in af.get("interface-address", []) if str(d(af, "address-family-name")) == "inet"]))
        neighbors = []
        lldp = await self._json("show lldp neighbors")
        for n in (lldp.get("lldp-neighbors-information") or [{}])[0].get("lldp-neighbor-information", []):
            neighbors.append(Neighbor(local_interface=str(d(n, "lldp-local-port-id") or d(n, "lldp-local-interface")),
                                      remote_name=str(d(n, "lldp-remote-system-name")),
                                      remote_mac=norm_mac(d(n, "lldp-remote-chassis-id")),
                                      remote_interface=str(d(n, "lldp-remote-port-id") or d(n, "lldp-remote-port-description")),
                                      protocol="lldp"))
        endpoints = []
        arp = await self._json("show arp no-resolve")
        for a in (arp.get("arp-table-information") or [{}])[0].get("arp-table-entry", []):
            mac = norm_mac(d(a, "mac-address"))
            if mac:
                endpoints.append(Endpoint(mac=mac, ip=norm_ip(d(a, "ip-address")), interface=str(d(a, "interface-name")),
                                          source="arp"))
        uplinks = {n.local_interface for n in neighbors}
        eth = await self._json("show ethernet-switching table")
        tables = eth.get("l2ng-l2ald-rtb-macdb") or eth.get("ethernet-switching-table-information") or []
        for t in tables:
            for e in (t.get("l2ng-l2ald-mac-entry-vlan") or t.get("ethernet-switching-table") or [{}])[0].get(
                    "l2ng-mac-entry", []) or []:
                mac, port = norm_mac(d(e, "l2ng-l2-mac-address")), str(d(e, "l2ng-l2-mac-logical-interface")).split(".")[0]
                if mac and port and port not in uplinks:
                    endpoints.append(Endpoint(mac=mac, interface=port, source="bridge"))
        return Snapshot(facts, interfaces, neighbors, endpoints)

    async def _configure(self, lines: list[str]) -> str:
        out = await self._ssh.shell(["configure private"] + lines + ["commit and-quit"], timeout=120)
        self.learned_host_key = self._ssh.host_key
        text = "\n".join(out)
        if re.search(r"error:|syntax error|unknown command", text, re.I):
            raise ExternalServiceError(f"Junos: {text.strip().splitlines()[-1]}")
        return "Готово"

    async def apply(self, action: str, p: dict) -> str:
        if action == "hostname":
            return await self._configure([f"set system host-name {p['name']}"])
        if action == "interface":
            lines = []
            if p.get("enabled") is not None:
                lines.append(f"{'delete' if p['enabled'] else 'set'} interfaces {p['name']} disable")
            if p.get("description") is not None:
                lines.append(f"set interfaces {p['name']} description \"{p['description']}\"")
            return await self._configure(lines)
        if action == "dns":
            return await self._configure(["delete system name-server"] + [f"set system name-server {s}" for s in p["servers"]])
        if action == "ntp":
            return await self._configure([f"set system ntp server {s}" for s in p["servers"]])
        if action == "reboot":
            try:
                await self._ssh.shell(["request system reboot"], answers={r"\[yes,no\].*$": "yes"}, timeout=20)
            except ExternalServiceError:
                pass
            return "Перезагрузка запущена"
        if action == "command":
            return await self._ssh.run(f"{p['command']} | no-more", timeout=120)
        raise UnsupportedAction("Juniper", action)

    async def backup(self) -> str:
        return await self._ssh.run("show configuration | display set | no-more", timeout=120)

    async def close(self) -> None:
        await self._ssh.close()
