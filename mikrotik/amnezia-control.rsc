{
:local gateway "192.168.0.210"
:local tunnelProbe "10.8.1.0"
:local lanIface "LAN"
:local wanIface "WAN"
:local flowPort 2055

/routing table add name=to-vpn fib comment=amnezia
/ip route add dst-address=($tunnelProbe . "/32") gateway=$gateway scope=10 comment="amnezia: tunnel probe via gateway"
/ip route add dst-address=0.0.0.0/0 gateway=$tunnelProbe target-scope=11 check-gateway=ping routing-table=to-vpn comment="amnezia: default via tunnel"
:local wanGw [/ip dhcp-client get [find interface=$wanIface] gateway]
/ip route add dst-address=0.0.0.0/0 gateway=$wanGw distance=10 routing-table=to-vpn comment="amnezia: fallback via provider"
/ip dhcp-client set [find interface=$wanIface] script=":if (\$bound=1) do={/ip route set [find comment=\"amnezia: fallback via provider\"] gateway=\$\"gateway-address\"}"
/routing rule add routing-mark=to-vpn action=lookup table=to-vpn comment="amnezia: policy table"

/ip firewall mangle add chain=prerouting in-interface=$lanIface src-address=("!" . $gateway) dst-address-list=vpn-sites connection-state=new action=mark-connection new-connection-mark=to-vpn passthrough=yes comment="amnezia: mark new conns to vpn-sites"
/ip firewall mangle add chain=prerouting in-interface=$lanIface src-address=("!" . $gateway) connection-mark=to-vpn dst-address-list=vpn-sites action=mark-routing new-routing-mark=to-vpn passthrough=no comment="amnezia: route marked conns via tunnel"
/ip firewall nat add chain=srcnat connection-mark=to-vpn out-interface=$lanIface action=masquerade comment="amnezia: hairpin to gateway" place-before=0
/ip firewall filter set [find comment=fasttrack] connection-mark=no-mark
/ip settings set send-redirects=no

/ip traffic-flow set enabled=yes interfaces=($lanIface . "," . $wanIface) active-flow-timeout=1m inactive-flow-timeout=15s
/ip traffic-flow target add dst-address=$gateway port=$flowPort version=9
}
