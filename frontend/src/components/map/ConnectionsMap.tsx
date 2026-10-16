import { CircleMarker, LayersControl, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import { latLngBounds } from "leaflet";
import type { GeoData } from "@/lib/types";

const TILES = "/tiles/{z}/{x}/{y}.png";
const OSM_ATTR ='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function FitBounds({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length) map.fitBounds(latLngBounds(pts).pad(0.4), { maxZoom: 6, animate: true });
  }, [pts.length]);
  return null;
}

export default function ConnectionsMap({ data, height = 480 }: { data: GeoData; height?: number }) {
  const max = Math.max(1, ...data.points.map((p) => p.connections));
  const pts: [number, number][] = [...data.points.map((p) => [p.lat, p.lon] as [number, number]), ...data.current.map((c) => [c.lat, c.lon] as [number, number])];
  return (
    <div style={{ height }} className="overflow-hidden rounded-lg border border-base-700">
      <MapContainer center={[55.75, 37.6]} zoom={3} minZoom={2} worldCopyJump style={{ height: "100%", width: "100%" }} attributionControl>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap · тёмная">
            <TileLayer url={TILES} attribution={OSM_ATTR} className="osm-dark" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap · светлая">
            <TileLayer url={TILES} attribution={OSM_ATTR} maxZoom={19} />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds pts={pts} />

        {data.server && (
          <CircleMarker center={[data.server.lat, data.server.lon]} radius={8} pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.9, weight: 2 }}>
            <Tooltip>Сервер Amnezia — {data.server.city || data.server.country} (точка выхода)</Tooltip>
          </CircleMarker>
        )}

        {data.points.map((p, i) => (
          <CircleMarker key={`p${i}`} center={[p.lat, p.lon]} radius={6 + 16 * Math.sqrt(p.connections / max)}
            pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.25, weight: 1 }}>
            <Popup>
              <div className="text-sm font-semibold">{p.city || "—"}, {p.country}</div>
              <div className="text-xs text-slate-400">{p.connections} подключ.</div>
              <div className="mt-1 text-xs">{p.clients.join(", ")}</div>
            </Popup>
          </CircleMarker>
        ))}
        {data.current.map((c) => (
          <CircleMarker key={c.id} center={[c.lat, c.lon]} radius={5}
            pathOptions={{ color: c.online ? "#34d399" : "#64748b", fillColor: c.online ? "#34d399" : "#64748b", fillOpacity: 0.95, weight: 2 }}>
            <Tooltip>{c.name} — {c.city || c.country} {c.online ? "· онлайн" : ""}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
