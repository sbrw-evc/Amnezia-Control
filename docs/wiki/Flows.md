# Flow analytics

The module follows the ideas of [Akvorado](https://github.com/akvorado/akvorado) in a lightweight form: no Kafka and
no separate orchestration, with storage in ClickHouse and the console built into the panel.

## Pipeline

```
MikroTik (Traffic Flow, NetFlow v9) ──UDP 2055──► goflow2 ──JSON──► enrichment ──batch──► ClickHouse.flows
```

Enrichment in `flow-collector`:

| Field | Source |
|---|---|
| `Direction` | `out` — source in the LAN, `in` — source outside |
| `Route` | `vpn` — next hop = gateway (outbound) or destination = router's LAN address (inbound via masquerade); otherwise `direct` |
| `LocalAddr` / `RemoteAddr` | Local and remote sides, taking direction into account |
| `RemoteCountry` | DB-IP City Lite |
| `RemoteAS` / `RemoteASName` | DB-IP ASN Lite |
| `Bytes` / `Packets` | Adjusted for the sampling rate |

Excluded: traffic inside the LAN, tunnel transport to the VPS, multicast/broadcast.
Site attribution happens at query time through the ClickHouse dictionary `sites` (`ip_trie`), which is filled when
`ip-list.json` is uploaded and custom prefixes are added — so a new mapping applies to existing data as well.

## Overview

Flows per second, time of the last flow, share of traffic through the VPN over 24 h, database size; a 24-hour chart;
top sites, AS, countries, protocols, remote ports and LAN devices over the last hour; the last flow with all fields.

## Visualization

| Option | Values |
|---|---|
| Period | 15 min … 30 days, custom range, shift back/forward, zoom out, auto refresh (10 s – 5 min) |
| Dimensions | up to 6, reorderable, a button to reverse the order |
| Limit | 1–50 series, the rest is grouped as "Other" |
| Top by | average (`avg`), peaks (`max`), latest values (`last`) |
| Units | bits/s, packets/s, flows/s |
| Graph | Stacked, 100%, Lines, Grid (small multiples), Sankey |
| Bidirectional | inbound traffic is drawn as negative values |
| Previous period | a dashed "total" line for the previous hour / day / week / month / year |

The table under the chart shows minimum, maximum, last, average, 95th percentile and total (bytes / packets / flows).
All options are kept in the URL — you can share a link. `Ctrl+Enter` applies.

### Dimensions

`Direction`, `Route`, `LocalAddr`, `RemoteAddr`, `RemoteNet` (/24), `RemoteAS`, `RemoteASName`, `RemoteCountry`,
`Site`, `SiteGroup`, `Proto`, `LocalPort`, `RemotePort`.

## Filter language

```
condition  := Field operator value | Field IN (value, ...) | Field NOTIN (value, ...)
expression := condition | NOT expression | (expression) | expression AND expression | expression OR expression
```

| Field type | Operators | Values |
|---|---|---|
| Address (`LocalAddr`, `RemoteAddr`, `RemoteNet`) | `=`, `!=` | `203.0.113.5`, `203.0.113.0/24` |
| AS (`RemoteAS`) | `=`, `!=`, `<`, `<=`, `>`, `>=`, `IN` | `AS13335` or `13335` |
| Port, protocol | numeric, `IN` | `443`; protocol — `tcp`, `udp`, `icmp` or a number |
| Strings (`Site`, `RemoteCountry`, `RemoteASName`, `SiteGroup`) and `Direction`, `Route` | `=`, `!=`, `IN`, `NOTIN`, `LIKE`, `UNLIKE`, `ILIKE`, `IUNLIKE` | `vpn`, `'%google%'` |

Field names are case-insensitive, strings use single or double quotes, comments are `--` and `/* */`.
All values are passed to ClickHouse as query parameters.

Examples:

```
Route = vpn AND RemoteCountry IN (US, NL)
Site LIKE '%google%' AND NOT Proto = udp
Direction = out AND LocalAddr = 192.168.0.50
RemoteAS = AS13335 OR RemoteASName ILIKE '%cloudflare%'
Route = direct AND SiteGroup = video   -- listed sites that bypassed the VPN
```

### Saved filters

A filter can be saved under a name; saved filters are visible to all operators. They can be deleted by their author or an administrator.

## Recent flows

A table of the last 200 flows within the hour, with a filter and auto refresh.

## Resources

ClickHouse is limited to 768 MB of memory, system logs are disabled, flows are kept for `FLOWS_TTL_DAYS` days.
For a home network this is tens of megabytes per day.
