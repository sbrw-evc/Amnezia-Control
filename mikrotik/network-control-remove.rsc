/ip firewall mangle remove [find comment~"amnezia"]
/ip firewall nat remove [find comment~"amnezia"]
/ip route remove [find comment~"amnezia"]
/routing rule remove [find comment~"amnezia"]
/routing table remove [find name=to-vpn]
/ip firewall address-list remove [find list=vpn-sites]
/ip firewall filter set [find comment=fasttrack] !connection-mark
/ip dhcp-client set [find interface=WAN] script=""
/ip traffic-flow target remove [find port=2055]
/ip traffic-flow set enabled=no
/ip firewall filter remove [find comment~"^amnezia: wireguard"]
/ip address remove [find comment="amnezia-control"]
/interface wireguard peers remove [find interface=wg-nc]
/interface wireguard remove [find name=wg-nc]
