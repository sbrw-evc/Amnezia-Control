"""Registry of supported device platforms: which driver, transports and credentials each one uses."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import partial
from typing import Callable

from ...domain.errors import DomainError
from .appliances import FortigateDriver, KeeneticDriver, LinuxDriver, OpenWrtDriver, OpnsenseDriver, PfsenseDriver
from .base import ACTIONS, Credentials, DeviceDriver, Target
from .cli import CliDriver, JunosDriver
from .controllers import MerakiDriver, OmadaDriver, RedfishDriver, UnifiDriver
from .mikrotik import MikrotikDriver
from .snmp import SnmpDriver


@dataclass(frozen=True)
class Platform:
    key: str
    vendor: str
    title: str
    segment: str  # home | smb | enterprise | any
    kind: str  # router | switch | firewall | controller | ap | server | other
    transports: dict[str, int | None]  # transport → default port
    credentials: tuple[str, ...]  # fields shown in the form
    factory: Callable[..., DeviceDriver]
    hint: str = ""
    aliases: tuple[str, ...] = field(default_factory=tuple)

    def driver(self, target: Target, creds: Credentials) -> DeviceDriver:
        if target.transport and target.transport not in self.transports:
            raise DomainError(f"{self.title}: transport {target.transport} is not supported")
        if not target.transport:
            target = Target(**{**target.__dict__, "transport": next(iter(self.transports))})
        if target.transport == "snmp" and self.factory is not SnmpDriver:
            return SnmpDriver(target, creds, self.vendor)
        return self.factory(target, creds, self.vendor)

    def capabilities(self, transport: str = "") -> list[str]:
        t = transport or next(iter(self.transports))
        if t == "snmp" and self.factory is not SnmpDriver:
            caps = SnmpDriver.capabilities
        elif isinstance(self.factory, partial):
            caps = self.factory(Target(host="localhost", transport=t), Credentials(), self.vendor).capabilities
        else:
            caps = self.factory.capabilities
        return [a for a in ACTIONS if a in caps]

    def describe(self) -> dict:
        return {"key": self.key, "vendor": self.vendor, "title": self.title, "segment": self.segment, "kind": self.kind,
                "transports": [{"name": t, "port": p} for t, p in self.transports.items()],
                "credentials": list(self.credentials), "hint": self.hint,
                "capabilities": {t: self.capabilities(t) for t in self.transports}}


def cli(profile: str):
    return partial(_cli, profile=profile)


def _cli(target, creds, vendor, profile):
    return CliDriver(target, creds, vendor, profile=profile)


SSH = ("username", "password", "private_key")
SNMP = ("snmp_version", "snmp_community", "snmp_user", "snmp_auth_protocol", "snmp_auth_password", "snmp_priv_protocol",
        "snmp_priv_password")
CLI = ("username", "password", "private_key", "enable_password")

PLATFORMS: dict[str, Platform] = {p.key: p for p in (
    Platform("mikrotik", "MikroTik", "MikroTik RouterOS 7", "any", "router", {"api": 443, "http": 80, "ssh": 22, "snmp": 161},
             ("username", "password", "private_key") + SNMP, MikrotikDriver,
             "REST API (www-ssl / www service) or SSH with RouterOS 7.13+; RouterOS 6 via SNMP", ("routeros", "mikrotik")),
    Platform("tplink_jetstream", "TP-Link", "TP-Link JetStream / Omada switch (standalone)", "smb", "switch",
             {"ssh": 22, "snmp": 161}, CLI + SNMP, cli("tplink_jetstream"),
             "Managed T / SG / SX series switches in standalone mode"),
    Platform("tplink", "TP-Link", "TP-Link (Archer, Deco, Easy Smart, etc.)", "home", "router", {"snmp": 161}, SNMP, SnmpDriver,
             "Home models without an open API are polled over SNMP; use Omada or OpenWrt for management"),
    Platform("omada", "TP-Link", "TP-Link Omada SDN Controller", "smb", "controller", {"https": 8043, "http": 8088},
             ("api_key", "api_secret"), OmadaDriver, "Open API: Client ID and Client Secret; the Site field is the Omada site name"),
    Platform("opnsense", "Deciso", "OPNsense", "smb", "firewall", {"https": 443, "http": 80, "snmp": 161},
             ("api_key", "api_secret") + SNMP, OpnsenseDriver, "API key / secret of a user with diagnostics rights"),
    Platform("pfsense", "Netgate", "pfSense", "smb", "firewall", {"https": 443, "http": 80, "snmp": 161},
             ("api_key", "username", "password") + SNMP, PfsenseDriver, "Requires the pfSense-pkg-RESTAPI package (v2)"),
    Platform("openwrt", "OpenWrt", "OpenWrt (GL.iNet, Turris, Cudy, etc.)", "home", "router", {"ssh": 22, "snmp": 161},
             SSH + SNMP, OpenWrtDriver, "SSH (dropbear); flow export needs the softflowd package"),
    Platform("keenetic", "Keenetic", "Keenetic", "home", "router", {"http": 80, "https": 443}, ("username", "password"),
             KeeneticDriver, "A user with web interface and RCI rights"),
    Platform("cisco_ios", "Cisco", "Cisco IOS / IOS-XE (Catalyst, ISR, ASR)", "enterprise", "switch", {"ssh": 22, "snmp": 161},
             CLI + SNMP, cli("cisco_ios")),
    Platform("cisco_nxos", "Cisco", "Cisco NX-OS (Nexus)", "enterprise", "switch", {"ssh": 22, "snmp": 161}, CLI + SNMP,
             cli("cisco_nxos")),
    Platform("meraki", "Cisco", "Cisco Meraki Dashboard", "enterprise", "controller", {"https": 443}, ("api_key",),
             MerakiDriver, "Host api.meraki.com; the Site field is the organization ID or name"),
    Platform("unifi", "Ubiquiti", "Ubiquiti UniFi Network (UDM, UCG, Cloud Key, controller)", "smb", "controller",
             {"https": 443}, ("username", "password", "api_key"), UnifiDriver,
             "Local console user; a self-hosted controller uses port 8443; Site is default or the site name"),
    Platform("edgeos", "Ubiquiti", "Ubiquiti EdgeRouter / VyOS", "smb", "router", {"ssh": 22, "snmp": 161}, SSH + SNMP,
             LinuxDriver),
    Platform("zyxel", "Zyxel", "Zyxel (GS / XGS / XS switches, USG / ATP / USG FLEX)", "smb", "switch",
             {"ssh": 22, "snmp": 161}, CLI + SNMP, cli("zyxel")),
    Platform("aruba_os", "HP", "HP ProCurve / HPE Aruba ArubaOS-Switch", "enterprise", "switch", {"ssh": 22, "snmp": 161},
             CLI + SNMP, cli("aruba_os")),
    Platform("aruba_cx", "HPE Aruba", "HPE Aruba AOS-CX", "enterprise", "switch", {"ssh": 22, "snmp": 161}, CLI + SNMP,
             cli("aruba_cx")),
    Platform("hp_comware", "HPE", "HPE FlexNetwork / OfficeConnect / H3C (Comware)", "enterprise", "switch",
             {"ssh": 22, "snmp": 161}, CLI + SNMP, cli("hp_comware")),
    Platform("dell_os10", "Dell", "Dell EMC PowerSwitch (OS10)", "enterprise", "switch", {"ssh": 22, "snmp": 161},
             CLI + SNMP, cli("dell_os10")),
    Platform("dell_nseries", "Dell", "Dell PowerSwitch N / PowerConnect", "smb", "switch", {"ssh": 22, "snmp": 161},
             CLI + SNMP, cli("dell_nseries")),
    Platform("juniper", "Juniper", "Juniper Junos (EX, SRX, MX, QFX)", "enterprise", "router", {"ssh": 22, "snmp": 161},
             SSH + SNMP, JunosDriver),
    Platform("huawei", "Huawei", "Huawei VRP (S / CE / AR)", "enterprise", "switch", {"ssh": 22, "snmp": 161}, CLI + SNMP,
             cli("huawei_vrp")),
    Platform("fortigate", "Fortinet", "Fortinet FortiGate", "enterprise", "firewall", {"https": 443, "snmp": 161},
             ("api_key",) + SNMP, FortigateDriver, "REST API administrator: API token"),
    Platform("eltex", "Eltex", "Eltex MES", "enterprise", "switch", {"ssh": 22, "snmp": 161}, CLI + SNMP, cli("eltex")),
    Platform("redfish", "Redfish", "Servers: Dell iDRAC, HPE iLO, Lenovo XCC, Supermicro (Redfish)", "enterprise", "server",
             {"https": 443}, ("username", "password"), RedfishDriver),
    Platform("linux", "Linux", "Linux / Proxmox / Synology / ASUS Merlin (SSH)", "any", "server", {"ssh": 22, "snmp": 161},
             SSH + SNMP, LinuxDriver),
    Platform("netgear", "Netgear", "Netgear (SNMP)", "smb", "switch", {"snmp": 161}, SNMP, SnmpDriver),
    Platform("dlink", "D-Link", "D-Link (SNMP)", "smb", "switch", {"snmp": 161}, SNMP, SnmpDriver),
    Platform("snmp", "", "Any device (SNMP v2c / v3)", "any", "other", {"snmp": 161}, SNMP, SnmpDriver,
             "Standard MIBs: interfaces, LLDP, ARP, MAC table"),
)}


def platform(key: str) -> Platform:
    p = PLATFORMS.get(key)
    if not p:
        raise DomainError(f"Unknown platform {key}")
    return p


__all__ = ["PLATFORMS", "Platform", "platform", "Credentials", "Target", "ACTIONS"]
