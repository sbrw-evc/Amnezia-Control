"""Controllers that manage many devices: TP-Link Omada, Ubiquiti UniFi, Cisco Meraki.

The controller itself is the managed device; its access points, switches and gateways become `children`
and their clients become endpoints attached to them."""
from __future__ import annotations

import httpx

from ...domain.errors import ExternalServiceError
from .appliances import HttpApiDriver
from .base import Child, Endpoint, Facts, Interface, Snapshot, UnsupportedAction, norm_ip, norm_mac, to_bool, to_int
from .transport import http_error

UNIFI_KIND = {"uap": "ap", "usw": "switch", "ugw": "gateway", "udm": "gateway", "uxg": "gateway", "ucg": "gateway"}


class OmadaDriver(HttpApiDriver):
    """TP-Link Omada SDN controller (software, OC200 / OC300 hardware) via the Open API: create an application
    with client credentials under Settings → Platform Integration → Open API."""
    capabilities = frozenset({"reboot", "endpoint_block"})
    default_port = 8043

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._cid = ""
        self._site = ""

    async def _auth(self) -> None:
        if self._cid:
            return
        info = await self._get("/api/info")
        self._cid = ((info or {}).get("result") or {}).get("omadacId", "")
        if not self._cid:
            raise ExternalServiceError(f"{self.target.host}: this is not an Omada controller (no omadacId)")
        try:
            r = await self.http.post("/openapi/authorize/token", params={"grant_type": "client_credentials"},
                                     json={"omadacId": self._cid, "client_id": self.creds.api_key,
                                           "client_secret": self.creds.api_secret})
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise http_error(self.target.host, e) from e
        token = (data.get("result") or {}).get("accessToken")
        if not token:
            raise ExternalServiceError(f"Omada: {data.get('msg') or 'no token issued, check the Client ID / Secret'}")
        self.http.headers["Authorization"] = f"AccessToken={token}"
        sites = await self._open(f"/openapi/v1/{self._cid}/sites", page=1, pageSize=100)
        rows = (sites or {}).get("data") or []
        wanted = self.target.site.strip().lower()
        site = next((s for s in rows if wanted and wanted in (str(s.get("name", "")).lower(), str(s.get("siteId", "")).lower())),
                    rows[0] if rows else None)
        if not site:
            raise ExternalServiceError("Omada: the controller has no sites")
        self._site = site["siteId"]

    async def _open(self, path: str, **params):
        r = await self._get(path, **params)
        if not isinstance(r, dict) or r.get("errorCode", 0) != 0:
            raise ExternalServiceError(f"Omada: {(r or {}).get('msg', 'API error')}")
        return r.get("result")

    async def collect(self) -> Snapshot:
        await self._auth()
        info = (await self._get("/api/info") or {}).get("result") or {}
        base = f"/openapi/v1/{self._cid}/sites/{self._site}"
        devices = (await self._open(f"{base}/devices", page=1, pageSize=1000) or {}).get("data") or []
        try:
            clients = (await self._open(f"{base}/clients", page=1, pageSize=1000) or {}).get("data") or []
        except ExternalServiceError:
            clients = []
        children = [Child(mac=norm_mac(d.get("mac")), name=str(d.get("name", "")), model=str(d.get("model") or d.get("showModel") or ""),
                          kind=str(d.get("type", "other")).lower(), ip=norm_ip(d.get("ip")),
                          online=to_int(d.get("status"), 0) in (1, 2, 14) or str(d.get("statusCategory", "")) == "1",
                          version=str(d.get("firmwareVersion", "")), uplink_mac=norm_mac(d.get("uplinkDeviceMac")),
                          uplink_port=str(d.get("uplinkDevicePort") or ""), clients=to_int(d.get("clientNum"), None))
                    for d in devices if norm_mac(d.get("mac"))]
        endpoints = []
        for c in clients:
            mac = norm_mac(c.get("mac"))
            if not mac:
                continue
            wireless = to_bool(c.get("wireless"))
            endpoints.append(Endpoint(mac=mac, ip=norm_ip(c.get("ip")), hostname=str(c.get("name") or c.get("hostName") or ""),
                                      source="controller", ssid=str(c.get("ssid", "")) if wireless else "",
                                      signal=to_int(c.get("rssi"), None) if wireless else None,
                                      attached_to=norm_mac(c.get("apMac") if wireless else c.get("switchMac") or c.get("gatewayMac")),
                                      port=str(c.get("port") or ""), vlan=to_int(c.get("vid"), None),
                                      blocked=to_bool(c.get("block"))))
        facts = Facts(hostname=str(info.get("name") or "Omada Controller"), vendor="TP-Link", model="Omada Controller",
                      os="Omada SDN", version=str(info.get("controllerVer", "")),
                      extra={"site": self._site, "devices": len(children), "clients": len(endpoints)})
        return Snapshot(facts, [], [], endpoints, children)

    async def apply(self, action: str, p: dict) -> str:
        await self._auth()
        base = f"/openapi/v1/{self._cid}/sites/{self._site}"
        if action == "reboot":
            mac = norm_mac(p.get("mac"))
            if not mac:
                raise ExternalServiceError("Specify the MAC of the Omada device to reboot")
            await self._send("POST", f"{base}/devices/{mac.replace(':', '-').upper()}/reboot", {})
            return "Reboot started"
        if action == "endpoint_block":
            mac = p["mac"].replace(":", "-").upper()
            await self._send("POST", f"{base}/clients/{mac}/{'block' if p['blocked'] else 'unblock'}", {})
            return "Client blocked" if p["blocked"] else "Client unblocked"
        raise UnsupportedAction("Omada", action)


class UnifiDriver(HttpApiDriver):
    """Ubiquiti UniFi Network: UniFi OS consoles (UDM, UCG, Cloud Key Gen2+) and the self-hosted controller.
    Logs in with a local user; the site is `default` unless set."""
    capabilities = frozenset({"reboot", "endpoint_block"})

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._prefix: str | None = None
        self._site = self.target.site.strip() or "default"

    async def _login(self) -> None:
        if self._prefix is not None:
            return
        try:
            if self.creds.api_key:
                self.http.headers["X-API-KEY"] = self.creds.api_key
                self._prefix = "/proxy/network"
                return
            r = await self.http.post("/api/auth/login", json={"username": self.creds.username,
                                                              "password": self.creds.password, "remember": False})
            if r.status_code == 200:
                self._prefix = "/proxy/network"
                csrf = r.headers.get("x-csrf-token") or r.headers.get("X-Updated-Csrf-Token")
                if csrf:
                    self.http.headers["X-CSRF-Token"] = csrf
                return
            if r.status_code not in (404, 405):
                raise ExternalServiceError(f"UniFi: login failed ({r.status_code})")
            r = await self.http.post("/api/login", json={"username": self.creds.username, "password": self.creds.password})
            if r.status_code != 200:
                raise ExternalServiceError(f"UniFi: login failed ({r.status_code})")
            self._prefix = ""
        except httpx.HTTPError as e:
            raise http_error(self.target.host, e) from e

    async def _api(self, path: str, optional: bool = False) -> list:
        await self._login()
        r = await self._get(f"{self._prefix}/api/s/{self._site}/{path}", optional=optional)
        return (r or {}).get("data", []) if isinstance(r, dict) else []

    async def collect(self) -> Snapshot:
        sysinfo = (await self._api("stat/sysinfo", optional=True) or [{}])[0]
        devices = await self._api("stat/device")
        clients = await self._api("stat/sta", optional=True)
        children = []
        interfaces = []
        for d in devices:
            mac = norm_mac(d.get("mac"))
            if not mac:
                continue
            up = d.get("uplink") or {}
            children.append(Child(mac=mac, name=str(d.get("name") or d.get("model", "")), model=str(d.get("model", "")),
                                  kind=UNIFI_KIND.get(str(d.get("type")), "other"), ip=norm_ip(d.get("ip")),
                                  online=to_int(d.get("state")) == 1, version=str(d.get("version", "")),
                                  uplink_mac=norm_mac(up.get("uplink_mac")),
                                  uplink_port=str(up.get("uplink_remote_port") or ""), clients=to_int(d.get("num_sta"), None)))
            for port in d.get("port_table") or []:
                interfaces.append(Interface(name=f"{d.get('name') or mac}/{port.get('port_idx')}",
                                            description=str(port.get("name", "")), oper_up=to_bool(port.get("up")),
                                            admin_up=to_bool(port.get("enable", True)), speed_mbps=to_int(port.get("speed"), None),
                                            rx_bytes=to_int(port.get("rx_bytes"), None), tx_bytes=to_int(port.get("tx_bytes"), None)))
        endpoints = []
        for c in clients:
            mac = norm_mac(c.get("mac"))
            if not mac:
                continue
            wired = to_bool(c.get("is_wired"))
            endpoints.append(Endpoint(mac=mac, ip=norm_ip(c.get("ip") or c.get("last_ip")),
                                      hostname=str(c.get("name") or c.get("hostname") or ""), source="controller",
                                      ssid="" if wired else str(c.get("essid", "")),
                                      signal=None if wired else to_int(c.get("signal") or c.get("rssi"), None),
                                      attached_to=norm_mac(c.get("sw_mac") if wired else c.get("ap_mac")),
                                      port=str(c.get("sw_port") or ""), vlan=to_int(c.get("vlan"), None),
                                      rx_rate=float(c.get("rx_bytes-r") or 0), tx_rate=float(c.get("tx_bytes-r") or 0),
                                      blocked=to_bool(c.get("blocked"))))
        facts = Facts(hostname=str(sysinfo.get("hostname") or sysinfo.get("name") or "UniFi Network"), vendor="Ubiquiti",
                      model="UniFi Network", os="UniFi Network", version=str(sysinfo.get("version", "")),
                      uptime_seconds=to_int(sysinfo.get("uptime"), None),
                      extra={"site": self._site, "devices": len(children), "clients": len(endpoints)})
        return Snapshot(facts, interfaces, [], endpoints, children)

    async def apply(self, action: str, p: dict) -> str:
        await self._login()
        base = f"{self._prefix}/api/s/{self._site}/cmd"
        if action == "reboot":
            mac = norm_mac(p.get("mac"))
            if not mac:
                raise ExternalServiceError("Specify the MAC of the UniFi device to reboot")
            await self._send("POST", f"{base}/devmgr", {"cmd": "restart", "mac": mac})
            return "Reboot started"
        if action == "endpoint_block":
            await self._send("POST", f"{base}/stamgr", {"cmd": "block-sta" if p["blocked"] else "unblock-sta", "mac": p["mac"]})
            return "Client blocked" if p["blocked"] else "Client unblocked"
        raise UnsupportedAction("UniFi", action)


class MerakiDriver(HttpApiDriver):
    """Cisco Meraki Dashboard API v1. Host is api.meraki.com (or a regional endpoint); the site is the organisation
    ID or name (the first organisation by default)."""
    capabilities = frozenset({"reboot"})

    def _client_kw(self) -> dict:
        return {"headers": {"Authorization": f"Bearer {self.creds.api_key}"}, "timeout": 40}

    async def _org(self) -> dict:
        orgs = await self._get("/api/v1/organizations") or []
        wanted = self.target.site.strip().lower()
        org = next((o for o in orgs if wanted and wanted in (str(o.get("id")).lower(), str(o.get("name", "")).lower())),
                   orgs[0] if orgs else None)
        if not org:
            raise ExternalServiceError("Meraki: the key sees no organizations")
        return org

    async def collect(self) -> Snapshot:
        org = await self._org()
        devices = await self._get(f"/api/v1/organizations/{org['id']}/devices", perPage=1000) or []
        statuses = {s.get("serial"): s for s in await self._get(f"/api/v1/organizations/{org['id']}/devices/statuses",
                                                                optional=True, perPage=1000) or []}
        kind = {"wireless": "ap", "switch": "switch", "appliance": "gateway", "cellularGateway": "gateway"}
        children = [Child(mac=norm_mac(d.get("mac")), name=str(d.get("name") or d.get("serial", "")), model=str(d.get("model", "")),
                          kind=kind.get(str(d.get("productType")), "other"), ip=norm_ip(d.get("lanIp")),
                          online=str(statuses.get(d.get("serial"), {}).get("status", "online")) == "online",
                          version=str(d.get("firmware", ""))) for d in devices if norm_mac(d.get("mac"))]
        endpoints = []
        for net_id in {d.get("networkId") for d in devices if d.get("networkId")}:
            for c in await self._get(f"/api/v1/networks/{net_id}/clients", optional=True, timespan=900, perPage=1000) or []:
                if norm_mac(c.get("mac")):
                    endpoints.append(Endpoint(mac=norm_mac(c.get("mac")), ip=norm_ip(c.get("ip")),
                                              hostname=str(c.get("description") or c.get("dhcpHostname") or ""),
                                              source="controller", ssid=str(c.get("ssid") or ""),
                                              attached_to=norm_mac(c.get("recentDeviceMac")),
                                              port=str(c.get("switchport") or ""), vlan=to_int(c.get("vlan"), None)))
        facts = Facts(hostname=str(org.get("name", "Meraki")), vendor="Cisco Meraki", model="Meraki Dashboard",
                      os="Meraki", extra={"organization": org.get("id"), "devices": len(children)})
        return Snapshot(facts, [], [], endpoints, children)

    async def apply(self, action: str, p: dict) -> str:
        if action == "reboot":
            mac = norm_mac(p.get("mac"))
            org = await self._org()
            devices = await self._get(f"/api/v1/organizations/{org['id']}/devices", perPage=1000) or []
            dev = next((d for d in devices if norm_mac(d.get("mac")) == mac), None)
            if not dev:
                raise ExternalServiceError("Meraki: no device with this MAC")
            await self._send("POST", f"/api/v1/devices/{dev['serial']}/reboot", {})
            return "Reboot started"
        raise UnsupportedAction("Meraki", action)


class RedfishDriver(HttpApiDriver):
    """Servers through their BMC: Dell iDRAC, HPE iLO, Lenovo XClarity, Supermicro, Fujitsu iRMC (DMTF Redfish)."""
    capabilities = frozenset({"hostname", "reboot"})

    def _client_kw(self) -> dict:
        return {"auth": (self.creds.username, self.creds.password)}

    async def _system(self) -> tuple[str, dict]:
        members = (await self._get("/redfish/v1/Systems") or {}).get("Members") or []
        if not members:
            raise ExternalServiceError("Redfish: no systems found")
        path = members[0]["@odata.id"]
        return path, await self._get(path) or {}

    async def collect(self) -> Snapshot:
        path, s = await self._system()
        mgr_members = (await self._get("/redfish/v1/Managers", optional=True) or {}).get("Members") or []
        mgr = await self._get(mgr_members[0]["@odata.id"], optional=True) if mgr_members else {}
        mem = s.get("MemorySummary") or {}
        cpu = s.get("ProcessorSummary") or {}
        facts = Facts(hostname=str(s.get("HostName") or s.get("Name") or ""), vendor=str(s.get("Manufacturer", "")),
                      model=str(s.get("Model", "")), os="Redfish", version=str(s.get("BiosVersion", "")),
                      serial=str(s.get("SerialNumber", "")),
                      extra={"power": s.get("PowerState"), "health": (s.get("Status") or {}).get("Health"),
                             "bmc_firmware": (mgr or {}).get("FirmwareVersion"), "cpus": cpu.get("Count"),
                             "cpu_model": cpu.get("Model"), "memory_gib": mem.get("TotalSystemMemoryGiB")})
        interfaces = []
        nics = (await self._get(f"{path}/EthernetInterfaces", optional=True) or {}).get("Members") or []
        for m in nics[:32]:
            n = await self._get(m["@odata.id"], optional=True) or {}
            interfaces.append(Interface(name=str(n.get("Id") or n.get("Name")), description=str(n.get("Description") or ""),
                                        mac=norm_mac(n.get("MACAddress") or n.get("PermanentMACAddress")),
                                        oper_up=str(n.get("LinkStatus", "")).lower() == "linkup",
                                        admin_up=n.get("InterfaceEnabled", True) is not False,
                                        speed_mbps=to_int(n.get("SpeedMbps"), None),
                                        addresses=[f"{a.get('Address')}/{_bits(a.get('SubnetMask'))}" for a in n.get("IPv4Addresses") or []
                                                   if a.get("Address")]))
        facts.mac = next((i.mac for i in interfaces if i.mac), "")
        return Snapshot(facts, interfaces)

    async def apply(self, action: str, p: dict) -> str:
        path, _ = await self._system()
        if action == "reboot":
            await self._send("POST", f"{path}/Actions/ComputerSystem.Reset", {"ResetType": "GracefulRestart"})
            return "Reboot started"
        if action == "hostname":
            await self._send("PATCH", path, {"HostName": p["name"]})
            return "Done"
        raise UnsupportedAction("Redfish", action)


def _bits(mask) -> int:
    try:
        return sum(bin(int(x)).count("1") for x in str(mask).split("."))
    except ValueError:
        return 32
