import asyncio
import os

from ..domain.errors import ExternalServiceError
from ..ports import CommandRunner, SecretStore

KEY_SECRET = "infra/ssh"


class SshKeyProvider:
    def __init__(self, secrets: SecretStore, path: str = "/run/panel/ssh_key"):
        self._secrets = secrets
        self._path = path
        self._ready = False

    async def path(self) -> str:
        if not self._ready:
            data = await self._secrets.get(KEY_SECRET)
            if not data or "private_key" not in data:
                raise ExternalServiceError("SSH-ключ не найден в OpenBao (infra/ssh)")
            os.makedirs(os.path.dirname(self._path), mode=0o700, exist_ok=True)
            tmp = f"{self._path}.{os.getpid()}"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(data["private_key"].rstrip("\n") + "\n")
            os.replace(tmp, self._path)
            self._ready = True
        return self._path


class SshRunner(CommandRunner):
    def __init__(self, host: str, user: str, keys: SshKeyProvider, known_hosts: str):
        self._target = f"{user}@{host}"
        self._keys = keys
        self._known_hosts = known_hosts
        self._host = host

    async def run(self, command: str, stdin: str | None = None, timeout: float = 30) -> str:
        key = await self._keys.path()
        args = ["ssh", "-i", key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
                "-o", f"UserKnownHostsFile={self._known_hosts}", "-o", "ConnectTimeout=10",
                "-o", "ControlMaster=auto", "-o", f"ControlPath=/run/panel/cm-%r@%h",
                "-o", "ControlPersist=300", "-o", "ServerAliveInterval=15", self._target, command]
        proc = await asyncio.create_subprocess_exec(
            *args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(
                proc.communicate(stdin.encode() if stdin is not None else None), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise ExternalServiceError(f"{self._host}: таймаут SSH")
        if proc.returncode != 0:
            msg = (err or out).decode(errors="replace").strip()
            raise ExternalServiceError(f"{self._host}: {msg or 'ssh exit ' + str(proc.returncode)}")
        return out.decode(errors="replace")
