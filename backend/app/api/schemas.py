import datetime as dt
import uuid

from pydantic import BaseModel, Field

from ..domain.models import Role


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class PasswordChangeIn(BaseModel):
    current: str
    new: str = Field(max_length=256)


class ClientIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    owner: str = ""
    contact: str = ""
    tags: list[str] = []
    note: str = ""
    expires_at: dt.datetime | None = None
    quota_gb: float | None = Field(default=None, ge=0)


class ClientPatch(BaseModel):
    name: str | None = None
    owner: str | None = None
    contact: str | None = None
    tags: list[str] | None = None
    note: str | None = None
    expires_at: dt.datetime | None = None
    quota_gb: float | None = Field(default=None, ge=0)


class BulkIn(BaseModel):
    ids: list[uuid.UUID]
    action: str


class ShareIn(BaseModel):
    hours: int | None = Field(default=None, ge=1, le=24 * 30)


class PanelUserIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = ""
    role: Role = Role.VIEWER
    password: str


class PanelUserPatch(BaseModel):
    display_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None


class PasswordResetIn(BaseModel):
    password: str


class ServerConfigIn(BaseModel):
    config: str = Field(max_length=500_000)
