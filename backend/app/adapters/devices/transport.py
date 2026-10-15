"""SSH and HTTP transports shared by the vendor drivers."""
from __future__ import annotations

import asyncio
import re

import asyncssh
import httpx

from ...domain.errors import ExternalServiceError
from .base import Credentials, Target

PAGER = re.compile(r"(--\s*more\s*--|<---\s*more\s*--->|press any key to continue|---- more ----|\(q\)uit)", re.I)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][AB012]|\x08|\r")


def clean(text: str) -> str:
    return ANSI.sub("", text)


class SshTransport:
    """asyncssh connection with trust-on-first-use host key pinning.

    The key seen on the first successful connection is stored with the device; later connections are refused
    when the server presents another key, before any credential is sent.
    """

    def __init__(self, target: Target, creds: Credentials, default_port: int = 22, legacy: bool = False):
        self._t = target
        self._c = creds
        self._port = target.port if target.transport == "ssh" and target.port else default_port
        self._legacy = legacy
        self._conn: asyncssh.SSHClientConnection | None = None
        self.host_key = ""

    async def connect(self) -> asyncssh.SSHClientConnection:
        if self._conn:
            return self._conn
        kw: dict = {"username": self._c.username or None, "connect_timeout": 15, "keepalive_interval": 15}
        if self._t.ssh_host_key:
            kw["known_hosts"] = ([asyncssh.import_public_key(self._t.ssh_host_key)], [], [])
        else:
            kw["known_hosts"] = None
        if self._c.private_key:
            kw["client_keys"] = [asyncssh.import_private_key(self._c.private_key)]
        else:
            kw["client_keys"] = None
        if self._c.password:
            kw["password"] = self._c.password
        if self._legacy:
            kw["kex_algs"] = ["curve25519-sha256", "ecdh-sha2-nistp256", "diffie-hellman-group14-sha256",
                              "diffie-hellman-group14-sha1", "diffie-hellman-group-exchange-sha1",
                              "diffie-hellman-group1-sha1"]
            kw["encryption_algs"] = ["aes128-ctr", "aes256-ctr", "aes128-gcm@openssh.com", "aes128-cbc", "aes256-cbc",
                                     "3des-cbc"]
            kw["server_host_key_algs"] = ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-256", "ssh-rsa", "ssh-dss"]
        try:
            self._conn = await asyncio.wait_for(asyncssh.connect(self._t.host, self._port, **kw), 25)
        except asyncssh.HostKeyNotVerifiable as e:
            raise ExternalServiceError(f"{self._t.host}: the SSH host key has changed ({e}). "
                                       "If the device was replaced, reset the saved key") from e
        except asyncssh.PermissionDenied as e:
            raise ExternalServiceError(f"{self._t.host}: SSH: wrong login, password or key") from e
        except (OSError, asyncssh.Error, asyncio.TimeoutError) as e:
            raise ExternalServiceError(f"{self._t.host}: SSH is unreachable ({e or type(e).__name__})") from e
        key = self._conn.get_server_host_key()
        self.host_key = key.export_public_key().decode().strip() if key else ""
        return self._conn

    async def run(self, command: str, timeout: float = 30) -> str:
        """Runs one command on an exec channel (Linux, RouterOS, OpenWrt, Junos, NX-OS)."""
        conn = await self.connect()
        try:
            r = await asyncio.wait_for(conn.run(command, check=False), timeout)
        except asyncio.TimeoutError as e:
            raise ExternalServiceError(f"{self._t.host}: command timed out") from e
        except asyncssh.Error as e:
            raise ExternalServiceError(f"{self._t.host}: {e}") from e
        out = r.stdout if isinstance(r.stdout, str) else (r.stdout or b"").decode(errors="replace")
        if r.exit_status not in (0, None) and not out.strip():
            err = r.stderr if isinstance(r.stderr, str) else (r.stderr or b"").decode(errors="replace")
            raise ExternalServiceError(f"{self._t.host}: {err.strip() or 'exit ' + str(r.exit_status)}")
        return clean(out)

    async def shell(self, commands: list[str], prompt: re.Pattern | None = None, timeout: float = 60,
                    enable: str = "", answers: dict[str, str] | None = None) -> list[str]:
        """Interactive CLI session for network OSes that do not run commands on an exec channel.

        Waits for the prompt after each command, answers pagers, returns one output per command.
        """
        conn = await self.connect()
        prompt = prompt or re.compile(r"(^|\n)[^\n]{0,80}[>#\]\$%]\s?$")
        replies = [(re.compile(k, re.I), v) for k, v in (answers or {}).items()]
        try:
            proc = await conn.create_process(term_type="vt100", term_size=(250, 1000), encoding="utf-8",
                                             errors="replace")
        except asyncssh.Error as e:
            raise ExternalServiceError(f"{self._t.host}: {e}") from e

        async def read_until_prompt(limit: float) -> str:
            buf = ""
            loop = asyncio.get_running_loop()
            deadline = loop.time() + limit
            while True:
                left = deadline - loop.time()
                if left <= 0:
                    raise ExternalServiceError(f"{self._t.host}: no CLI prompt (timed out)")
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(65536), min(left, 1.5))
                except asyncio.TimeoutError:
                    chunk = None
                if chunk == "":
                    return clean(buf)
                if chunk:
                    buf += chunk
                    tail = clean(buf[-300:])
                    if PAGER.search(tail.splitlines()[-1] if tail.splitlines() else ""):
                        proc.stdin.write(" ")
                        buf = PAGER.sub("", buf)
                        continue
                    reply = next((v for k, v in replies if k.search(tail)), None)
                    if reply is not None:
                        proc.stdin.write(reply + "\n")
                        buf = buf[:-len(tail)] if tail and buf.endswith(tail) else buf
                        continue
                    if re.search(r"password:\s*$", tail, re.I) and enable:
                        proc.stdin.write(enable + "\n")
                        continue
                    if prompt.search(tail.rstrip(" ") if tail.endswith(" ") else tail):
                        return clean(buf)
                elif chunk is None and prompt.search(clean(buf[-300:])):
                    return clean(buf)

        try:
            await read_until_prompt(20)
            outputs = []
            for cmd in commands:
                proc.stdin.write(cmd + "\n")
                out = await read_until_prompt(timeout)
                lines = out.splitlines()
                while lines and not lines[0].strip():
                    lines = lines[1:]
                # drop the echoed command and the trailing prompt
                if lines and cmd.strip() and cmd.strip()[:20] in lines[0]:
                    lines = lines[1:]
                if lines and prompt.search(lines[-1]):
                    lines = lines[:-1]
                outputs.append("\n".join(lines))
            return outputs
        finally:
            try:
                proc.stdin.write("exit\n")
            except (OSError, asyncssh.Error):
                pass
            proc.close()
            # network OSes drop the whole connection when the CLI session ends: reconnect for the next one
            await self.close()

    async def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None


def http_client(target: Target, default_scheme: str = "https", default_port: int | None = None,
                **kw) -> httpx.AsyncClient:
    scheme = "http" if target.transport == "http" else default_scheme
    port = target.port or default_port
    host = target.host if ":" not in target.host or target.host.startswith("[") else f"[{target.host}]"
    base = f"{scheme}://{host}" + (f":{port}" if port else "")
    return httpx.AsyncClient(base_url=base, verify=target.verify_tls, timeout=kw.pop("timeout", 20),
                             follow_redirects=True, **kw)


def http_error(host: str, e: Exception) -> ExternalServiceError:
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if code in (401, 403):
            return ExternalServiceError(f"{host}: API denied access ({code}); check the credentials")
        return ExternalServiceError(f"{host}: API returned {code}: {e.response.text[:200]}")
    return ExternalServiceError(f"{host}: API is unreachable ({e or type(e).__name__})")
