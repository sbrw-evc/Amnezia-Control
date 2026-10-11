from __future__ import annotations

import logging
import os

from .adapters.amnezia import AmneziaDockerGateway
from .adapters.clickhouse import ClickHouseClient
from .services.flows import FlowService
from .adapters.geoip import DbIpGeoLocator
from .adapters.mikrotik import MikrotikSshRouter
from .adapters.openbao import OpenBaoSecretStore
from .adapters.ssh import SshKeyProvider, SshRunner
from .adapters.telegram import TelegramNotifier
from .cluster import CONFIG_LOCK_KEY, DistributedLock, LeaderElection, LiveState, PgEventBus, plain_dsn
from .config import Settings
from .db.base import Database
from .services.alerts import AlertService
from .services.analytics import AnalyticsService
from .services.audit import AuditService
from .services.auth import AuthService
from .services.backups import BackupService
from .services.clients import VpnClientService
from .services.configs import ClientConfigBuilder
from .services.health import HealthMonitor
from .services.notifications import NotificationService
from .services.policy import PolicyEnforcer
from .services.routing import RoutingService, SiteListCompiler
from .services.server import ServerConfigEditor, ServerService
from .services.settings import SettingsService
from .services.tokens import ApiTokenService
from .services.traffic import TrafficCollector
from .services.users import PanelUserService
from .workers import PeriodicJob, Scheduler

log = logging.getLogger(__name__)
STARTUP_LOCK_KEY = 7_331_003


class Container:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        dsn = plain_dsn(cfg.database_url)
        self.bus = PgEventBus(dsn)
        self.live = LiveState(self.bus)
        self.db = Database(cfg.database_url)
        self.startup_lock = DistributedLock(dsn, STARTUP_LOCK_KEY)
        self.secrets = OpenBaoSecretStore(cfg.bao_addr, cfg.bao_approle_dir, cfg.bao_kv_mount)
        keys = SshKeyProvider(self.secrets)
        known_hosts = os.path.join(cfg.data_dir, "known_hosts")
        self.vpn_gateway = AmneziaDockerGateway(SshRunner(cfg.awg_host, cfg.awg_ssh_user, keys, known_hosts),
                                                cfg.awg_container, cfg.awg_dir, cfg.awg_iface, cfg.awg_bin)
        self.router = MikrotikSshRouter(SshRunner(cfg.router_host, cfg.router_ssh_user, keys, known_hosts))
        self.geo = DbIpGeoLocator(cfg.geoip_dir)

        self.settings = SettingsService(self.db)
        self.audit = AuditService(self.db, self.bus)
        self.alerts = AlertService(self.db, self.bus)
        self.notifier = TelegramNotifier(self.secrets, lambda: self.settings.get("notify_telegram_chat_id"))
        self.notifications = NotificationService(self.notifier, self.settings)
        self.alerts.notifications = self.notifications
        self.auth = AuthService(self.db, self.secrets, self.audit, cfg.session_ttl_hours)
        self.tokens = ApiTokenService(self.db, self.audit)
        self.users = PanelUserService(self.db, self.auth, self.audit)
        self.editor = ServerConfigEditor(self.vpn_gateway, DistributedLock(dsn, CONFIG_LOCK_KEY))
        self.server = ServerService(self.db, self.editor, self.audit)
        self.clients = VpnClientService(self.db, self.editor, self.vpn_gateway, self.secrets,
                                        ClientConfigBuilder(cfg.awg_container), self.settings, self.audit, self.bus,
                                        cfg.awg_host, cfg.public_base_url, self.live)
        self.collector = TrafficCollector(self.db, self.vpn_gateway, self.clients, self.geo, self.alerts, self.bus)
        self.analytics = AnalyticsService(self.db, self.live, self.alerts, self.settings, self.geo, cfg.awg_host)
        self.policy = PolicyEnforcer(self.db, self.clients, self.alerts, self.settings)
        self.health = HealthMonitor(self.db, self.secrets, self.alerts, self.settings)
        self.routing = RoutingService(self.db, self.router, SiteListCompiler(cfg.awg_host), self.alerts, self.audit,
                                      {"gateway_ip": cfg.gateway_ip, "lan_cidr": cfg.lan_cidr, "vpn_host": cfg.awg_host})
        self.backups = BackupService(self.db, self.secrets, self.settings, self.audit, cfg.backup_dir)
        self.clickhouse = ClickHouseClient(cfg.clickhouse_url, cfg.clickhouse_user, cfg.clickhouse_password,
                                           cfg.clickhouse_db)
        self.flows = FlowService(self.clickhouse, self.db, self.audit)
        self.routing.flows = self.flows
        self.election = LeaderElection(dsn, self._become_leader, self._lose_leadership)
        self.scheduler: Scheduler | None = None

    async def start(self) -> None:
        await self.bus.start()
        await self.live.start()
        async with self.startup_lock.hold():
            await self.db.create_schema()
            await self.auth.ensure_initial_admin(self.cfg.initial_admin_user, self.cfg.initial_admin_password)
        await self.election.start()

    async def _become_leader(self) -> None:
        try:
            await self.geo.refresh()
        except Exception:
            log.exception("geoip refresh failed")
        try:
            await self.clients.sync()
        except Exception:
            log.exception("initial sync failed; will retry in background")

        async def flow_schema() -> None:
            await self.flows.schema.ensure(self.cfg.flows_ttl_days)
            if not self.flows.sites_seeded:
                await self._seed_sites()

        try:
            await flow_schema()
        except Exception:
            log.exception("clickhouse schema not ready yet")

        async def poll_interval() -> float:
            return float(await self.settings.get("poll_seconds"))

        async def purge() -> None:
            await self.collector.purge(await self.settings.get("retention_days"))

        self.scheduler = Scheduler()
        for job in (
            PeriodicJob("traffic", poll_interval, self.collector.poll),
            PeriodicJob("sync", 300, self.clients.sync, initial_delay=300),
            PeriodicJob("policy", 60, self.policy.run, initial_delay=20),
            PeriodicJob("health", 60, self.health.run, initial_delay=30),
            PeriodicJob("router", 60, self.routing.monitor, initial_delay=10),
            PeriodicJob("custom-domains", 3600, self.routing.refresh_domains, initial_delay=900),
            PeriodicJob("geoip", 86400, self.geo.refresh, initial_delay=86400),
            PeriodicJob("purge", 3600, purge, initial_delay=600),
            PeriodicJob("backup", 86400, self.backups.scheduled, initial_delay=1800),
            PeriodicJob("flow-schema", 300, flow_schema, initial_delay=300),
        ):
            self.scheduler.add(job)
        self.scheduler.start()

    async def _seed_sites(self) -> None:
        rows = await self.clickhouse.query("SELECT count() AS n FROM site_prefixes")
        if int(rows[0]["n"]) == 0:
            customs = await self.routing.custom_list()
            if customs:
                await self.flows.add_sites(self.routing.custom_sites(customs))
        self.flows.sites_seeded = True

    async def _lose_leadership(self) -> None:
        if self.scheduler:
            await self.scheduler.stop()
            self.scheduler = None

    async def stop(self) -> None:
        await self.election.stop()
        await self._lose_leadership()
        await self.live.stop()
        await self.bus.stop()
        await self.db.engine.dispose()
