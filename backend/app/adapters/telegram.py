import httpx

from ..domain.errors import DomainError, ExternalServiceError
from ..ports import Notifier, SecretStore

TOKEN_SECRET = "notify/telegram"


class TelegramNotifier(Notifier):
    def __init__(self, secrets: SecretStore, chat_id_provider):
        self._secrets = secrets
        self._chat_id = chat_id_provider
        self._http = httpx.AsyncClient(timeout=15)

    async def _token(self) -> str | None:
        data = await self._secrets.get(TOKEN_SECRET)
        return (data or {}).get("token")

    async def configured(self) -> bool:
        return bool(await self._token() and await self._chat_id())

    async def set_token(self, token: str) -> None:
        token = token.strip()
        if ":" not in token:
            raise DomainError("Invalid bot token format")
        r = await self._http.get(f"https://api.telegram.org/bot{token}/getMe")
        if r.status_code != 200 or not r.json().get("ok"):
            raise DomainError("Telegram rejected the token")
        await self._secrets.put(TOKEN_SECRET, {"token": token, "bot": r.json()["result"].get("username", "")})

    async def bot_name(self) -> str | None:
        data = await self._secrets.get(TOKEN_SECRET)
        return (data or {}).get("bot")

    async def send(self, text: str) -> None:
        token, chat = await self._token(), await self._chat_id()
        if not token or not chat:
            raise DomainError("Telegram is not set up")
        try:
            r = await self._http.post(f"https://api.telegram.org/bot{token}/sendMessage",
                                      json={"chat_id": chat, "text": text, "parse_mode": "HTML",
                                            "disable_web_page_preview": True})
        except httpx.HTTPError as e:
            raise ExternalServiceError(f"Telegram is unreachable: {e}") from e
        if r.status_code != 200:
            raise ExternalServiceError(f"Telegram: {r.json().get('description', r.status_code)}")
