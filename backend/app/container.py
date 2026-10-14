from __future__ import annotations

import logging
import os

from .adapters.amnezia import AmneziaDockerGateway
from .adapters.clickhouse import ClickHouseClient
from .services.flows import FlowService
from .adapters.geoip import DbIpGeoLocator
from .adapters.mikrotik import MikrotikSshRouter
from .adapters.mikrotik_wg import MikrotikWireguard
from .adapters.openbao import OpenBaoSecretStore
from .adapters.oui import OuiDatabase
from .adapters.ssh import SshKeyProvider, SshRunner
from .adapters.telegram import TelegramNotifier
from .cluster import CONFIG_LOCK_KEY, DistributedLock, LeaderElection, LiveState, PgEventBus, plain_dsn
from .config import Settings
from .db.base import Database
from .services.alerts import AlertService
from .services.analytics import AnalyticsService
from .services.audit import AuditService
from .services.auth import AuthService
from .services.backends import AmneziaBackend, MikrotikBackend
from .services.backups import BackupService
from .services.clients import VpnClientService
from .services.configs import ClientConfigBuilder
from .services.detector import Detector
from .services.devices import DeviceService
from .services.flows import DEFAULT_THREAT_LISTS
from .services.health import HealthMonitor
from .services.notifications import NotificationService
from .services.policy import PolicyEnforcer
from .services.routing import RoutingService, SiteListCompiler
from .services.server import ServerConfigEditor, ServerService
from .services.settings import SettingsService
from .services.tokens import ApiTokenService
from .services.topology import TopologyService
from .services.traffic import TrafficCollector
from .services.users import PanelUserService
from .workers import PeriodicJob, Scheduler

log = logging.getLogger(__name__)
STARTUP_LOCK_KEY = 7_331_003
MT_LOCK_KEY = 7_331_004


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
        router_ssh = SshRunner(cfg.router_host, cfg.router_ssh_user, keys, known_hosts)
        self.router = MikrotikSshRouter(router_ssh)
        self.mikrotik_wg = MikrotikWireguard(router_ssh, cfg.mt_wg_iface, cfg.mt_wg_network, cfg.mt_wg_port)
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
        self.amnezia = AmneziaBackend(self.editor, self.vpn_gateway, ClientConfigBuilder(cfg.awg_container),
                                      self.settings, cfg.awg_host)
        self.mikrotik = MikrotikBackend(self.mikrotik_wg, self.settings, DistributedLock(dsn, MT_LOCK_KEY), cfg.lan_cidr)
        backends = [self.amnezia, self.mikrotik]
        self.clients = VpnClientService(self.db, backends, self.secrets, self.settings, self.audit, self.bus,
                                        cfg.public_base_url, self.live)
        self.collector = TrafficCollector(self.db, backends, self.clients, self.geo, self.alerts, self.bus)
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
        self.oui = OuiDatabase(cfg.data_dir)
        self.devices = DeviceService(self.db, self.secrets, self.audit, self.alerts, self.bus, self.settings, self.oui,
                                     {"router_host": cfg.router_host, "router_ssh_user": cfg.router_ssh_user,
                                      "collector_host": cfg.gateway_ip})
        self.detector = Detector(self.clickhouse, self.db, self.alerts, self.audit)
        self.topology = TopologyService(self.db, self.settings, self.flows,
                                        {"vpn_host": cfg.awg_host, "router_host": cfg.router_host})
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
        self.oui.load()
        for seed in (self.devices.seed_router, self.detector.seed_defaults):
            try:
                await seed()
            except Exception:
                log.exception("seed %s failed", seed.__name__)

        async def poll_interval() -> float:
            return float(await self.settings.get("poll_seconds"))

        async def purge() -> None:
            await self.collector.purge(await self.settings.get("retention_days"))
            await self.devices.purge_endpoints(int(await self.settings.get("endpoint_retention_days")))

        async def threat_interval() -> float:
            return max(1.0, float(await self.settings.get("threat_refresh_hours"))) * 3600

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
            PeriodicJob("devices", 30, self.devices.poll_due, initial_delay=15),
            PeriodicJob("flow-enrichment", 120, self.sync_enrichment, initial_delay=45),
            PeriodicJob("flow-rules", 60, self.detector.run, initial_delay=90),
            PeriodicJob("threats", threat_interval, self.refresh_threats, initial_delay=120),
            PeriodicJob("rdns", 600, self.refresh_ptr, initial_delay=300),
            PeriodicJob("oui", 86400 * 7, self.oui.refresh, initial_delay=60),
        ):
            self.scheduler.add(job)
        self.scheduler.start()

    async def sync_enrichment(self) -> None:
        exporters = await self.devices.exporter_map()
        hosts = [{"ip": e["ip"], "name": e["name"] or e["vendor"] or e["mac"], "mac": e["mac"]}
                 for e in await self.devices.endpoints(limit=20000) if e["ip"]]
        nets = await self.devices.local_networks()
        await self.flows.sync_enrichment(exporters, hosts, nets)

    async def refresh_threats(self) -> dict:
        if not await self.settings.get("threat_enabled"):
            return {}
        lists = await self.settings.get("threat_lists") or DEFAULT_THREAT_LISTS
        exclude = [x.strip() for x in str(await self.settings.get("threat_exclude") or "").replace(",", " ").split()]
        status = await self.flows.refresh_threats(lists, exclude + [self.cfg.lan_cidr])
        await self.settings.update({"threat_status": status})
        return status

    async def refresh_ptr(self) -> None:
        if await self.settings.get("rdns_enabled"):
            await self.flows.refresh_ptr()

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
