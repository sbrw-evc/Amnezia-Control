from ..db.base import Database
from ..db.models import PanelUser
from ..db.repositories import UserRepo


def user_dto(u: PanelUser) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "email": u.email, "role": u.role.value,
            "is_active": u.is_active, "source": u.source, "external_id": u.external_id, "groups": list(u.groups or []),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "synced_at": u.synced_at.isoformat() if u.synced_at else None}


class PanelUserService:
    """Users are read-only records synchronised from SPA (services/identity/spa.py): creating them, their roles and
    enabling or disabling them are managed in SPA."""

    def __init__(self, db: Database):
        self._db = db

    async def list(self) -> list[dict]:
        async with self._db.session() as s:
            return [user_dto(u) for u in await UserRepo(s).all(order_by=PanelUser.id)]
