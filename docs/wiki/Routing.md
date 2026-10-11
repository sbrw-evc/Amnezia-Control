# Routing

## Site list

`ip-list.json` format — an object mapping a site to its description:

```json
{
  "youtube.com": {
    "name": "youtube.com",
    "group": "youtube",
    "ip4": ["142.250.74.46"],
    "cidr4": ["142.250.0.0/15"],
    "replace": { "cidr4": { "142.250.0.0/15": ["142.250.0.0/16"] } }
  }
}
```

On upload (**Routing → Upload ip-list.json**, administrators only):

1. `ip4` and `cidr4` are taken; broad prefixes are replaced according to the `replace` map.
2. IPv6, private and reserved ranges, prefixes wider than /8 and the VPS address are dropped.
3. Prefixes are collapsed into a minimal set.
4. The `vpn-sites` address list on MikroTik is updated **as a diff** (stale entries removed, new ones added), without interrupting routing.
5. The "prefix → site → group" mapping is loaded into the ClickHouse dictionary for flow analytics.

The page shows the number of sites and prefixes, the share of the IPv4 address space and the site groups.

## Custom addresses through the VPN

Public IPv4 addresses or prefixes that should go through the VPN in addition to the list. They are stored in the panel,
added to the router immediately and kept across subsequent list uploads.

## Where will the traffic go

Check a domain or IP: the domain is resolved over DNS-over-HTTPS (Cloudflare, Google), which bypasses ISP DNS
tampering; each address is then matched against the current `vpn-sites` on the router. The prefix that sends the
address into the VPN is shown. For CDNs the addresses may differ from what your devices receive.

## Status

LAN → MikroTik → gateway → server diagram, whether the tunnel route is active, the fallback route, mangle rule counters,
router CPU and uptime. When the tunnel is inactive, a critical alert is raised.
