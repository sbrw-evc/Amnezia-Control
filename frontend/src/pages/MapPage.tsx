import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Globe2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Fmt } from "@/lib/format";
import { k, t } from "@/i18n";
import Flag from "@/components/ui/Flag";
import type { Range } from "@/lib/types";
import { Badge, Card, Page, PageHeader, Segmented, StatusDot } from "@/components/ui/Primitives";
import { Skeleton } from "@/components/ui/Feedback";
import ConnectionsMap from "@/components/map/ConnectionsMap";

/** Labels are English keys, drawn with t(). */
const RANGES: { value: Range; label: string }[] = [{ value: "24h", label: k("24 h") }, { value: "7d", label: k("7 d") }, { value: "30d", label: k("30 d") }, { value: "90d", label: k("90 d") }];

export default function MapPage() {
  const [range, setRange] = useState<Range>("30d");
  const geo = useQuery({ queryKey: ["geo", range], queryFn: () => api.analytics.geo(range), refetchInterval: 60_000 });
  const d = geo.data;

  return (
    <Page>
      <PageHeader title={t("Connections map")} icon={<Globe2 size={20} />}
        subtitle={t("Where clients connect to the VPN from (by the endpoint IP, DB-IP Lite geo database)")}
        actions={<Segmented layoutId="map-range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: t(r.label) }))} />} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card bodyClass="p-2">
          {d ? <ConnectionsMap data={d} height={600} /> : <Skeleton className="h-[600px]" />}
          <div className="flex flex-wrap items-center gap-4 px-2 pt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> {t("client online")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> {t("client offline")}</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-blue-400 bg-blue-500/30" /> {t("connection points (size — number of connections)")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> {t("server")}</span>
            <span className="ml-auto">IP Geolocation by <a className="text-blue-300" href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a></span>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title={t("Clients on the map")} bodyClass="max-h-[300px] overflow-y-auto p-0">
            {[...(d?.current ?? [])].sort((a, b) => Number(b.online) - Number(a.online)).map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                className="flex items-center gap-2 border-b border-base-700/50 px-4 py-2 text-sm last:border-0">
                <StatusDot on={c.online} />
                <span className="flex-1 truncate text-slate-200">{c.name}</span>
                <span className="text-xs text-slate-500">{c.city || c.country}</span>
              </motion.div>
            ))}
          </Card>
          <Card title={t("Recent connections")} bodyClass="max-h-[260px] overflow-y-auto p-0">
            {(d?.recent ?? []).map((r) => (
              <div key={r.ts + r.ip} className="flex items-center gap-2 border-b border-base-700/50 px-4 py-2 text-sm last:border-0">
                <Flag code={r.country_code} />
                <div className="min-w-0 flex-1"><div className="truncate text-slate-200">{r.client}</div><div className="mono text-slate-500">{r.ip}</div></div>
                <Badge>{Fmt.ago(r.ts)}</Badge>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Page>
  );
}
