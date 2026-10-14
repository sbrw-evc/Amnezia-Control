from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = "postgresql+asyncpg://amnezia:amnezia@postgres:5432/amnezia"

    bao_addr: str = "http://openbao:8200"
    bao_approle_dir: str = "/bao/approle"
    bao_kv_mount: str = "amnezia"

    awg_host: str
    awg_ssh_user: str = "root"
    awg_container: str = "amnezia-awg2"
    awg_iface: str = "awg0"
    awg_bin: str = "awg"
    awg_dir: str = "/opt/amnezia/awg"

    router_host: str = "192.168.0.1"
    router_ssh_user: str = "admin"
    gateway_ip: str = "192.168.0.210"
    lan_cidr: str = "192.168.0.0/24"
    mt_wg_iface: str = "wg-nc"
    mt_wg_network: str = "10.9.0.0/24"
    mt_wg_port: int = 51820

    clickhouse_url: str = "http://clickhouse:8123"
    clickhouse_user: str = "amnezia"
    clickhouse_password: str = ""
    clickhouse_db: str = "flows"
    flows_ttl_days: int = 30

    initial_admin_user: str = "admin"
    initial_admin_password: str = ""

    geoip_dir: str = "/data/geoip"
    data_dir: str = "/data"
    backup_dir: str = "/data/backups"

    session_ttl_hours: int = 12
    cookie_secure: bool = False
    public_base_url: str = "http://localhost:8080"


@lru_cache
def get_settings() -> Settings:
    return Settings()
