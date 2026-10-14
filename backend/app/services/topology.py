"""Network map built from what the devices report: LLDP / CDP / MNDP neighbours, controller uplinks, clients on
ports and Wi-Fi, plus live traffic per client from the flows."""
from __future__ import annotations

import logging
import re

from sqlalchemy import select

from ..adapters.devices import PLATFORMS
from ..adapters.devices.discovery import WEB_HINTS
from ..adapters.devices.parsers import shorten_iface
from ..db.base import Database
from ..db.models import NetworkDevice, NetworkEndpoint
from .common import utcnow
from .settings import SettingsService

log = logging.getLogger(__name__)


def _iface_key(name: str) -> str:
    return shorten_iface(name or "").lower().replace(" ", "")


class TopologyService:
    def __init__(self, db: Database, settings: SettingsService, flows, context: dict):
        self._db = db
        self._settings = settings
        self._flows = flows
        self._ctx = context

    async def _traffic(self) -> dict[str, dict]:
        if not self._flows:
            return {}
        try:
            rows = await self._flows.local_traffic(300)
        except Exception as e:
            log.debug("topology traffic unavailable: %s", e)
            return {}
        return {r["ip"]: r for r in rows}

    async def build(self, include_offline: bool = False, include_endpoints: bool = True) -> dict:
        offline_after = int(await self._settings.get("endpoint_offline_minutes")) * 60
        now = utcnow()
        async with self._db.session() as s:
            devices = (await s.execute(select(NetworkDevice).order_by(NetworkDevice.name))).scalars().all()
            eps = (await s.execute(select(NetworkEndpoint).order_by(NetworkEndpoint.last_seen.desc()).limit(3000))).scalars().all() \
                if include_endpoints else []
        traffic = await self._traffic()
        nodes: dict[str, dict] = {}
        edges: dict[tuple, dict] = {}
        by_mac: dict[str, str] = {}
        by_ip: dict[str, str] = {}
        by_name: dict[str, str] = {}

        def add_edge(a: str, b: str, kind: str, **kw) -> None:
            if a == b or a not in nodes or b not in nodes:
                return
            key = tuple(sorted((a, b))) + (kind,)
            if key in edges:
                for k, v in kw.items():
                    if v and not edges[key].get(k):
                        edges[key][k] = v
                return
            edges[key] = {"source": a, "target": b, "kind": kind, **kw}

        # managed devices
        for d in devices:
            nid = f"dev:{d.id}"
            p = PLATFORMS.get(d.platform)
            facts = d.facts or {}
            nodes[nid] = {"id": nid, "type": "device", "label": d.name, "role": d.role, "status": d.status,
                          "vendor": facts.get("vendor") or (p.vendor if p else ""), "model": facts.get("model", ""),
                          "ip": d.host, "mac": facts.get("mac", ""), "device_id": str(d.id), "platform": d.platform,
                          "location": d.location, "x": d.map_x, "y": d.map_y, "clients": 0, "bps": 0.0,
                          "interfaces": len(d.interfaces or []), "error": d.last_error if d.status != "up" else ""}
            for m in [facts.get("mac")] + [i.get("mac") for i in d.interfaces or []]:
                if m:
                    by_mac.setdefault(m.lower(), nid)
            for ip in [d.host, d.flow_exporter_ip] + [a.split("/")[0] for i in d.interfaces or [] for a in i.get("addresses") or []]:
                if ip:
                    by_ip.setdefault(ip, nid)
            for n in (d.name, facts.get("hostname")):
                if n:
                    by_name.setdefault(n.lower().split(".")[0], nid)

        # a neighbour seen by MAC that resolves to a known device by name or IP lends that MAC to it,
        # so controller uplinks pointing at the neighbour's MAC find the right node
        for d in devices:
            for n in d.neighbors or []:
                mac = (n.get("remote_mac") or "").lower()
                hit = by_ip.get(n.get("remote_ip") or "") or by_name.get((n.get("remote_name") or "").lower().split(".")[0])
                if mac and hit:
                    by_mac.setdefault(mac, hit)

        # devices behind controllers (APs, switches, gateways)
        for d in devices:
            parent = f"dev:{d.id}"
            for c in d.children or []:
                mac = (c.get("mac") or "").lower()
                nid = by_mac.get(mac) or f"mac:{mac}"
                if nid not in nodes:
                    nodes[nid] = {"id": nid, "type": "child", "label": c.get("name") or mac, "role": c.get("kind") or "other",
                                  "status": "up" if c.get("online", True) else "down", "vendor": nodes[parent]["vendor"],
                                  "model": c.get("model", ""), "ip": c.get("ip", ""), "mac": mac, "controller": parent,
                                  "clients": 0, "bps": 0.0, "version": c.get("version", "")}
                    by_mac[mac] = nid
                    if c.get("ip"):
                        by_ip.setdefault(c["ip"], nid)
                    if c.get("name"):
                        by_name.setdefault(c["name"].lower(), nid)
                else:
                    nodes[nid]["controller"] = parent
        for d in devices:
            parent = f"dev:{d.id}"
            for c in d.children or []:
                nid = by_mac.get((c.get("mac") or "").lower())
                up = by_mac.get((c.get("uplink_mac") or "").lower())
                if nid and up:
                    add_edge(up, nid, "link", target_port=c.get("uplink_port") or "")
                elif nid:
                    add_edge(parent, nid, "managed")

        # LLDP / CDP / MNDP neighbours
        rates: dict[str, dict[str, dict]] = {
            f"dev:{d.id}": {_iface_key(i.get("name", "")): i for i in d.interfaces or []} for d in devices}
        for d in devices:
            nid = f"dev:{d.id}"
            for n in d.neighbors or []:
                remote = by_mac.get((n.get("remote_mac") or "").lower()) or by_ip.get(n.get("remote_ip") or "") \
                    or by_name.get((n.get("remote_name") or "").lower().split(".")[0])
                if not remote:
                    key = (n.get("remote_mac") or n.get("remote_ip") or n.get("remote_name") or "").lower()
                    if not key:
                        continue
                    remote = f"nb:{key}"
                    if remote not in nodes:
                        guess = next((k for pat, k in WEB_HINTS if re.search(pat, n.get("remote_platform") or "", re.I)), "")
                        nodes[remote] = {"id": remote, "type": "neighbor", "label": n.get("remote_name") or key,
                                         "role": "other", "status": "unknown", "ip": n.get("remote_ip", ""),
                                         "mac": n.get("remote_mac", ""), "model": n.get("remote_platform", "")[:80],
                                         "platform_guess": guess, "clients": 0, "bps": 0.0}
                        for k in (n.get("remote_mac"), ):
                            if k:
                                by_mac[k.lower()] = remote
                iface = rates.get(nid, {}).get(_iface_key(n.get("local_interface", "")), {})
                add_edge(nid, remote, "link", source_port=n.get("local_interface", ""),
                         target_port=n.get("remote_interface", ""), protocol=n.get("protocol", ""),
                         bps=max(iface.get("rx_bps") or 0, iface.get("tx_bps") or 0) or None,
                         utilization=iface.get("utilization"), speed=iface.get("speed_mbps"))

        # consumers; an infrastructure node seen as a client somewhere (a controller or an AP in the router's ARP)
        # is attached there when nothing else connects it
        shown = 0
        infra_seen: dict[str, tuple[str, str]] = {}
        for e in eps:
            infra = by_mac.get(e.mac) or (by_ip.get(e.ip) if e.ip else None)
            if infra:
                parent = by_mac.get((e.attached_to or "").lower()) or (f"dev:{e.device_id}" if e.device_id else None)
                if parent and parent != infra and parent in nodes:
                    infra_seen.setdefault(infra, (parent, e.port or e.interface))
                continue
            age = (now - e.last_seen).total_seconds()
            online = age <= offline_after
            if not online and not include_offline:
                continue
            parent = by_mac.get((e.attached_to or "").lower()) or (f"dev:{e.device_id}" if e.device_id else None)
            if not parent or parent not in nodes:
                continue
            t = traffic.get(e.ip or "", {})
            nid = f"ep:{e.mac}"
            nodes[nid] = {"id": nid, "type": "endpoint", "label": e.alias or e.hostname or e.ip or e.mac,
                          "status": "online" if online else "offline", "ip": e.ip, "mac": e.mac, "vendor": e.vendor,
                          "hostname": e.hostname, "alias": e.alias, "ssid": e.ssid, "signal": e.signal,
                          "bps": float(t.get("bps") or 0), "rx_bps": float(t.get("in_bps") or 0),
                          "tx_bps": float(t.get("out_bps") or 0), "blocked": e.blocked, "last_seen": e.last_seen,
                          "parent": parent}
            add_edge(parent, nid, "wifi" if e.ssid or e.source == "wifi" else "wired",
                     source_port=e.port or e.interface, label=e.ssid, bps=nodes[nid]["bps"] or None)
            nodes[parent]["clients"] = nodes[parent].get("clients", 0) + 1
            nodes[parent]["bps"] = nodes[parent].get("bps", 0.0) + nodes[nid]["bps"]
            shown += 1

        linked = {e["source"] for e in edges.values() if e["kind"] in ("link", "wan")} | \
            {e["target"] for e in edges.values() if e["kind"] in ("link", "wan")}
        for infra, (parent, port) in infra_seen.items():
            if infra not in linked:
                add_edge(parent, infra, "wired", source_port=port)

        # internet, VPN
        nodes["internet"] = {"id": "internet", "type": "internet", "label": "Интернет", "status": "up"}
        edge_routers = [nid for nid, n in nodes.items()
                        if n.get("type") in ("device", "child") and n.get("role") in ("router", "firewall", "gateway")]
        for nid in edge_routers:
            add_edge("internet", nid, "wan")
        if not edge_routers:
            first = next((nid for nid, n in nodes.items() if n.get("type") == "device"), None)
            if first:
                add_edge("internet", first, "wan")
        if self._ctx.get("vpn_host"):
            nodes["vpn"] = {"id": "vpn", "type": "vpn", "label": "VPN-сервер AmneziaWG", "ip": self._ctx["vpn_host"],
                            "status": "up"}
            add_edge("internet", "vpn", "wan")
            router = by_ip.get(self._ctx.get("router_host") or "") or (edge_routers[0] if edge_routers else None)
            if router:
                add_edge(router, "vpn", "tunnel", label="AmneziaWG")

        stats = {"devices": sum(1 for n in nodes.values() if n["type"] == "device"),
                 "children": sum(1 for n in nodes.values() if n["type"] == "child"),
                 "neighbors": sum(1 for n in nodes.values() if n["type"] == "neighbor"),
                 "endpoints": shown, "online": sum(1 for n in nodes.values() if n.get("status") == "online"),
                 "down": sum(1 for n in nodes.values() if n["type"] == "device" and n["status"] in ("down", "error")),
                 "traffic": bool(traffic)}
        return {"nodes": list(nodes.values()), "edges": list(edges.values()), "stats": stats, "generated_at": now}
