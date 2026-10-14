"""CLI drivers over a real SSH session: an asyncssh server that behaves like Cisco IOS and like a Linux host."""
import asyncio

import asyncssh
import pytest

from app.adapters.devices import platform
from app.adapters.devices.base import Credentials, Target, validate_action
from test_drivers import ARP_IOS, CDP, IOS_INTERFACES, IOS_VERSION, LINUX, LLDP, MAC_IOS

OUTPUT = {"show version": IOS_VERSION, "show interfaces": IOS_INTERFACES, "show lldp neighbors detail": LLDP,
          "show cdp neighbors detail": CDP, "show ip arp": ARP_IOS, "show mac address-table": MAC_IOS,
          "show running-config": "hostname core-sw\n!\nend"}


class IosShell:
    def __init__(self, log):
        self.log = log

    async def __call__(self, process: asyncssh.SSHServerProcess):
        if process.command:  # exec channel: behave like Linux
            self.log.append(("exec", process.command))
            process.stdout.write(LINUX.replace("\\\\", "\\") if "#HOST" in process.command else "ok\n")
            process.exit(0)
            return
        mode = ""
        process.stdout.write("\r\ncore-sw#")
        try:
            async for line in process.stdin:
                cmd = line.strip()
                self.log.append(("shell", cmd))
                if cmd == "exit":
                    if mode:
                        mode = ""
                    else:
                        break
                elif cmd == "configure terminal":
                    mode = "(config)"
                elif cmd.startswith("interface "):
                    mode = "(config-if)"
                elif cmd == "end":
                    mode = ""
                elif cmd == "write memory":
                    process.stdout.write("Building configuration...\r\n[OK]\r\n")
                elif cmd == "reload":
                    process.stdout.write("Proceed with reload? [confirm]")
                    continue
                elif cmd in OUTPUT:
                    for chunk in OUTPUT[cmd].splitlines():
                        process.stdout.write(chunk + "\r\n")
                elif cmd and not cmd.startswith(("terminal", "hostname", "ip name-server", "ntp", "no shutdown", "shutdown", "description")):
                    process.stdout.write("% Invalid input detected at '^' marker.\r\n")
                process.stdout.write(f"core-sw{mode}#")
        except (asyncssh.BreakReceived, asyncssh.TerminalSizeChanged, asyncssh.ConnectionLost):
            pass
        process.exit(0)


class Server(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        return username == "admin" and password == "secret"


async def with_server(fn):
    log = []
    key = asyncssh.generate_private_key("ssh-ed25519")
    server = await asyncssh.create_server(Server, "127.0.0.1", 0, server_host_keys=[key], process_factory=IosShell(log))
    port = server.sockets[0].getsockname()[1]
    try:
        return await fn(port, log, key.export_public_key().decode().strip())
    finally:
        server.close()
        await server.wait_closed()


def test_cisco_ios_over_ssh():
    async def go(port, log, host_key):
        p = platform("cisco_ios")
        drv = p.driver(Target("127.0.0.1", port=port, transport="ssh"), Credentials(username="admin", password="secret"))
        snap = await drv.collect()
        await drv.close()
        assert drv.learned_host_key.split()[:2] == host_key.split()[:2]
        assert snap.facts.hostname == "core-sw" and snap.facts.model == "WS-C2960X-48TS-L"
        assert len(snap.interfaces) == 3 and snap.interfaces[0].rx_bytes == 567890
        assert {n.protocol for n in snap.neighbors} == {"lldp", "cdp"}
        # Gi1/0/5 has a CDP neighbour (an AP): MACs learned there belong to the AP, not to the switch port
        assert not any(e.source == "bridge" for e in snap.endpoints)
        assert {e.ip for e in snap.endpoints if e.source == "arp"} == {"192.168.0.1", "192.168.0.50"}
        drv = p.driver(Target("127.0.0.1", port=port, transport="ssh", ssh_host_key=drv.learned_host_key),
                       Credentials(username="admin", password="secret"))
        out = await drv.apply("interface", validate_action("interface", {"name": "Gi1/0/2", "enabled": False, "description": "spare"}))
        assert out == "Готово"
        cmds = [c for k, c in log if k == "shell"]
        i = cmds.index("configure terminal")
        assert cmds[i:i + 6] == ["configure terminal", "interface Gi1/0/2", "shutdown", "description spare", "exit", "end"]
        assert "write memory" in cmds
        assert "Building configuration" in (await drv.apply("command", {"command": "write memory"}))
        assert (await drv.backup()).strip().startswith("hostname core-sw")
        assert await drv.apply("reboot", {}) == "Перезагрузка запущена"
        assert "reload" in [c for k, c in log if k == "shell"]
        await drv.close()
        bad = p.driver(Target("127.0.0.1", port=port, transport="ssh", ssh_host_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBadKeyBadKeyBadKeyBadKeyBadKeyBadKeyBadKey00"),
                       Credentials(username="admin", password="secret"))
        with pytest.raises(Exception):
            await bad.collect()
        await bad.close()
    asyncio.run(with_server(go))


def test_linux_and_wrong_password_over_ssh():
    async def go(port, log, _):
        drv = platform("linux").driver(Target("127.0.0.1", port=port, transport="ssh"), Credentials(username="admin", password="secret"))
        snap = await drv.collect()
        await drv.close()
        assert snap.facts.hostname == "openwrt" and any(i.name == "eth0" for i in snap.interfaces)
        drv = platform("linux").driver(Target("127.0.0.1", port=port, transport="ssh"), Credentials(username="admin", password="nope"))
        with pytest.raises(Exception, match="неверный логин"):
            await drv.collect()
        await drv.close()
    asyncio.run(with_server(go))
