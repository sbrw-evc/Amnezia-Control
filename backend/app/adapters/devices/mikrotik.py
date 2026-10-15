"""MikroTik RouterOS 7 (also CHR and RouterOS on any RouterBOARD / CRS / hAP / cAP).

Two transports with the same data: the REST API (`/rest`, service www-ssl or www) and SSH, where RouterOS 7.13+
serialises `print as-value` to JSON. RouterOS 6 has neither and should be polled over SNMP.
"""
from __future__ import annotations

import json
import re

import httpx

from ...domain.errors import ExternalServiceError
from ..mikrotik_wg import parse_duration
from .base import (Child, DeviceDriver, Endpoint, Facts, Interface, Neighbor, Snapshot, norm_ip, norm_mac, to_bool,
                   to_int)
from .transport import SshTransport, http_client, http_error

FLOW_VERSIONS = {"netflow5": "5", "netflow9": "9", "ipfix": "IPFIX"}


def _q(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


class MikrotikDriver(DeviceDriver):
    capabilities = frozenset({"hostname", "interface", "dns", "ntp", "flow_export", "reboot", "command", "backup"})
    default_transport = "api"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._ssh: SshTransport | None = None
        self._http: httpx.AsyncClient | None = None
        if self.target.transport == "ssh":
            self._ssh = SshTransport(self.target, self.creds)
        else:
            self._http = http_client(self.target, auth=(self.creds.username, self.creds.password))

    # ---- transport-neutral primitives ----
    async def _list(self, path: str, optional: bool = False) -> list[dict]:
        try:
            if self._http:
                r = await self._http.get(f"/rest/{path}")
                if r.status_code in (400, 404) and optional:
                    return []
                r.raise_for_status()
                data = r.json()
            else:
                out = await self._ssh.run(
                    f":put [:serialize to=json value=[/{path.replace('/', ' ')} print detail as-value]]")
                if re.search(r"bad command|syntax error|no such command", out, re.I):
                    if optional:
                        return []
                    raise ExternalServiceError(f"{self.target.host}: RouterOS does not support :serialize; it needs 7.13+ "
                                               "or the REST API transport")
                data = json.loads(out.strip() or "[]")
        except (httpx.HTTPError, ValueError) as e:
            if optional:
                return []
            raise http_error(self.target.host, e) if isinstance(e, httpx.HTTPError) else \
                ExternalServiceError(f"{self.target.host}: unexpected RouterOS response") from e
        finally:
            if self._ssh and self._ssh.host_key:
                self.learned_host_key = self._ssh.host_key
        if isinstance(data, dict):
            return [data]
        return data or []

    async def _one(self, path: str) -> dict:
        rows = await self._list(path, optional=True)
        return rows[0] if rows else {}

    async def _cli(self, script: str) -> str:
        if self._ssh:
            out = await self._ssh.run(script, timeout=60)
            self.learned_host_key = self._ssh.host_key
            if re.search(r"^\s*(failure:|syntax error|bad command|expected |input does not match|no such item)",
                         out, re.M):
                raise ExternalServiceError(f"RouterOS: {out.strip().splitlines()[0]}")
            return out
        try:
            r = await self._http.post("/rest/execute", json={"script": script, "as-string": True}, timeout=60)
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise http_error(self.target.host, e) from e
        return data.get("ret", "") if isinstance(data, dict) else str(data)

    # ---- collection ----
    async def collect(self) -> Snapshot:
        res = await self._one("system/resource")
        ident = await self._one("system/identity")
        board = await self._one("system/routerboard")
        total, free = to_int(res.get("total-memory")), to_int(res.get("free-memory"))
        facts = Facts(hostname=str(ident.get("name", "")), vendor="MikroTik",
                      model=str(board.get("model") or res.get("board-name") or ""), os="RouterOS",
                      version=str(res.get("version", "")).split(" ")[0], serial=str(board.get("serial-number", "")),
                      uptime_seconds=parse_duration(str(res.get("uptime", ""))),
                      cpu_percent=float(to_int(res.get("cpu-load"))) if res.get("cpu-load") is not None else None,
                      memory_percent=round((total - free) * 100 / total, 1) if total else None,
                      extra={"architecture": res.get("architecture-name", "")})

        addrs: dict[str, list[str]] = {}
        for a in await self._list("ip/address", optional=True):
            if not to_bool(a.get("disabled")):
                addrs.setdefault(str(a.get("interface")), []).append(str(a.get("address")))
        interfaces = []
        for i in await self._list("interface"):
            name = str(i.get("name", ""))
            interfaces.append(Interface(
                name=name, description=str(i.get("comment", "")), type=str(i.get("type", "")),
                mac=norm_mac(i.get("mac-address")), admin_up=not to_bool(i.get("disabled")),
                oper_up=to_bool(i.get("running")), mtu=to_int(i.get("actual-mtu") or i.get("mtu")) or None,
                addresses=addrs.get(name, []), rx_bytes=to_int(i.get("rx-byte"), None),
                tx_bytes=to_int(i.get("tx-byte"), None)))
        if not facts.mac:
            facts.mac = next((i.mac for i in interfaces if i.mac and i.type in ("ether", "bridge")), "")

        neighbors = [Neighbor(local_interface=str(n.get("interface", "")).split(",")[0],
                              remote_name=str(n.get("identity", "")), remote_ip=norm_ip(n.get("address")),
                              remote_mac=norm_mac(n.get("mac-address")),
                              remote_interface=str(n.get("interface-name", "")),
                              remote_platform=" ".join(x for x in (str(n.get("platform", "")),
                                                                   str(n.get("board", ""))) if x),
                              protocol=str(n.get("discovered-by", "mndp")).split(",")[0])
                     for n in await self._list("ip/neighbor", optional=True)]

        endpoints: list[Endpoint] = []
        for a in await self._list("ip/arp", optional=True):
            mac = norm_mac(a.get("mac-address"))
            if mac and not to_bool(a.get("invalid")):
                endpoints.append(Endpoint(mac=mac, ip=norm_ip(a.get("address")), interface=str(a.get("interface", "")),
                                          source="arp"))
        for lease in await self._list("ip/dhcp-server/lease", optional=True):
            mac = norm_mac(lease.get("active-mac-address") or lease.get("mac-address"))
            if mac:
                endpoints.append(Endpoint(mac=mac, ip=norm_ip(lease.get("active-address") or lease.get("address")),
                                          hostname=str(lease.get("host-name") or lease.get("comment") or ""),
                                          interface=str(lease.get("server", "")), source="dhcp",
                                          blocked=to_bool(lease.get("block-access"))))
        for path in ("interface/wifi/registration-table", "interface/wireless/registration-table",
                     "caps-man/registration-table"):
            for w in await self._list(path, optional=True):
                mac = norm_mac(w.get("mac-address"))
                if mac:
                    sig = str(w.get("signal") or w.get("signal-strength") or "").split("@")[0]
                    endpoints.append(Endpoint(mac=mac, interface=str(w.get("interface", "")), source="wifi",
                                              ssid=str(w.get("ssid", "")), signal=to_int(sig, None)))
        uplinks = {n.local_interface for n in neighbors}
        for h in await self._list("interface/bridge/host", optional=True):
            mac = norm_mac(h.get("mac-address"))
            port = str(h.get("on-interface") or h.get("interface") or "")
            if mac and not to_bool(h.get("local")) and port not in uplinks:
                endpoints.append(Endpoint(mac=mac, interface=port, source="bridge", vlan=to_int(h.get("vid"), None)))

        children = [Child(mac=norm_mac(c.get("radio-mac") or c.get("mac-address")), name=str(c.get("identity", "")),
                          model=str(c.get("board", "")), kind="ap", ip=norm_ip(c.get("address")),
                          version=str(c.get("version", "")))
                    for c in await self._list("caps-man/remote-cap", optional=True)
                    + await self._list("interface/wifi/capsman/remote-cap", optional=True)
                    if norm_mac(c.get("radio-mac") or c.get("mac-address"))]
        return Snapshot(facts, interfaces, neighbors, endpoints, children)

    # ---- settings ----
    async def apply(self, action: str, p: dict) -> str:
        if action == "hostname":
            await self._cli(f"/system identity set name={_q(p['name'])}")
        elif action == "interface":
            parts = []
            if p.get("enabled") is not None:
                parts.append(f"disabled={'no' if p['enabled'] else 'yes'}")
            if p.get("description") is not None:
                parts.append(f"comment={_q(p['description'])}")
            await self._cli(f"/interface set [find name={_q(p['name'])}] {' '.join(parts)}")
        elif action == "dns":
            await self._cli(f"/ip dns set servers={','.join(p['servers'])}")
        elif action == "ntp":
            await self._cli(f"/system ntp client set enabled=yes servers={','.join(p['servers'])}")
        elif action == "flow_export":
            if p["protocol"] == "sflow":
                return await super().apply(action, p)
            target = f"[find dst-address={p['collector']} port={p['port']}]"
            if p["enabled"]:
                await self._cli(
                    f"/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m inactive-flow-timeout=15s; "
                    f":if ([:len [/ip traffic-flow target find dst-address={p['collector']} port={p['port']}]] = 0) "
                    f"do={{/ip traffic-flow target add dst-address={p['collector']} port={p['port']} "
                    f"version={FLOW_VERSIONS[p['protocol']]}}} else={{/ip traffic-flow target set {target} "
                    f"version={FLOW_VERSIONS[p['protocol']]}}}")
            else:
                await self._cli(f"/ip traffic-flow target remove {target}")
            return f"Flow export {'enabled' if p['enabled'] else 'disabled'}: {p['collector']}:{p['port']}"
        elif action == "reboot":
            if self._ssh:
                await self._ssh.run(":execute \"/system reboot\"", timeout=10)
            else:
                try:
                    await self._http.post("/rest/system/reboot", json={}, timeout=10)
                except httpx.HTTPError:
                    pass  # the router drops the connection while rebooting
            return "Reboot started"
        elif action == "command":
            return await self._cli(p["command"])
        else:
            return await super().apply(action, p)
        return "Done"

    async def backup(self) -> str:
        return await self._cli("/export terse")

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
        if self._ssh:
            await self._ssh.close()
