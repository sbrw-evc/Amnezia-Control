import re

from ..ports import CommandRunner, RouterGateway

LIST = "vpn-sites"


class MikrotikSshRouter(RouterGateway):
    def __init__(self, runner: CommandRunner):
        self._ssh = runner

    async def status(self) -> dict:
        out = await self._ssh.run(
            ':put ("count=" . [/ip firewall address-list print count-only where list=' + LIST + ']); '
            ':foreach r in=[/ip route find where routing-table=to-vpn] do={ '
            ':put ("route=" . [/ip route get $r gateway] . "|" . [/ip route get $r active] . "|" . [/ip route get $r distance]) }; '
            ':foreach m in=[/ip firewall mangle find where comment~"amnezia"] do={ '
            ':put ("mangle=" . [/ip firewall mangle get $m comment] . "|" . [/ip firewall mangle get $m bytes] . "|" . [/ip firewall mangle get $m packets]) }; '
            ':put ("cpu=" . [/system resource get cpu-load]); '
            ':put ("uptime=" . [/system resource get uptime]); '
            ':put ("version=" . [/system resource get version]); '
            ':put ("board=" . [/system resource get board-name])', timeout=20)
        res: dict = {"routes": [], "mangle": []}
        for line in out.splitlines():
            if "=" not in line:
                continue
            k, _, v = line.strip().partition("=")
            if k == "route":
                gw, active, dist = v.split("|")
                res["routes"].append({"gateway": gw, "active": active == "true", "distance": int(dist or 0)})
            elif k == "mangle":
                c, b, p = v.split("|")
                res["mangle"].append({"comment": c, "bytes": int(b or 0), "packets": int(p or 0)})
            elif k in ("count", "cpu"):
                res[k] = int(v or 0)
            elif k:
                res[k] = v
        tunnel = next((r for r in res["routes"] if r["distance"] == 1), None)
        res["tunnel_active"] = bool(tunnel and tunnel["active"])
        return res

    @staticmethod
    def _validate(cidr: str) -> str:
        if not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?", cidr):
            raise ValueError(f"bad prefix {cidr}")
        return cidr

    async def list_addresses(self) -> list[str]:
        out = await self._ssh.run(
            f':foreach i in=[/ip firewall address-list find list={LIST}] do={{'
            f':put [/ip firewall address-list get $i address]}}', timeout=120)
        return [self._norm(x.strip()) for x in out.splitlines() if x.strip()]

    async def add_address(self, cidr: str) -> None:
        c = self._norm(self._validate(cidr))
        await self._ssh.run(f"/ip firewall address-list add list={LIST} address={c} comment=custom")

    async def remove_address(self, cidr: str) -> None:
        c = self._norm(self._validate(cidr))
        await self._ssh.run(f"/ip firewall address-list remove [find list={LIST} address={c}]")

    async def replace_address_list(self, cidrs: list[str]) -> int:
        for c in cidrs:
            self._validate(c)
        current = set(await self.list_addresses())
        wanted = {self._norm(c) for c in cidrs}
        stale, new = sorted(current - wanted), sorted(wanted - current)
        for batch in self._chunks(stale):
            cmds = "; ".join(f"remove [find list={LIST} address={c}]" for c in batch)
            await self._ssh.run(f"/ip firewall address-list {{ {cmds} }}", timeout=180)
        for batch in self._chunks(new):
            cmds = "; ".join(f"add list={LIST} address={c}" for c in batch)
            await self._ssh.run(f"/ip firewall address-list {{ {cmds} }}", timeout=180)
        return len(wanted)

    @staticmethod
    def _norm(c: str) -> str:
        return c[:-3] if c.endswith("/32") else c

    @staticmethod
    def _chunks(items: list[str], size: int = 300):
        for i in range(0, len(items), size):
            yield items[i:i + size]
