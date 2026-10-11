import base64
import io
import json
import zlib
from dataclasses import dataclass

import qrcode
import qrcode.image.svg

from .server import ServerConfig


@dataclass(frozen=True)
class ClientBundle:
    name: str
    config: str
    amnezia_key: str
    qr_svg: str


class ClientConfigBuilder:
    def __init__(self, container_name: str):
        self._container = container_name

    def build(self, *, name: str, server: ServerConfig, server_public_key: str, psk: str | None,
              private_key: str, public_key: str, address: str, endpoint_host: str, dns: str) -> ClientBundle:
        conf = self._conf(server, server_public_key, psk, private_key, address, endpoint_host, dns)
        return ClientBundle(name=name, config=conf,
                            amnezia_key=self._amnezia_key(name, conf, server, server_public_key, psk, private_key,
                                                          public_key, address, endpoint_host, dns),
                            qr_svg=self._qr(conf))

    @staticmethod
    def _conf(server, server_pub, psk, priv, address, host, dns) -> str:
        obfs = "".join(f"{k} = {v}\n" for k, v in server.obfuscation.items())
        psk_line = f"PresharedKey = {psk}\n" if psk else ""
        return (f"[Interface]\nAddress = {address}\nDNS = {dns}\nPrivateKey = {priv}\n{obfs}\n"
                f"[Peer]\nPublicKey = {server_pub}\n{psk_line}AllowedIPs = 0.0.0.0/0, ::/0\n"
                f"Endpoint = {host}:{server.port}\nPersistentKeepalive = 25\n")

    def _amnezia_key(self, name, conf, server, server_pub, psk, priv, pub, address, host, dns) -> str:
        obfs = server.obfuscation
        dns_list = [d.strip() for d in dns.split(",") if d.strip()] or ["1.1.1.1"]
        last = dict(obfs, config=conf, hostName=host, port=int(server.port or 0), mtu="1376",
                    client_ip=address.split("/")[0], client_priv_key=priv, client_pub_key=pub,
                    server_pub_key=server_pub, psk_key=psk or "", clientId=pub)
        awg = dict(obfs, last_config=json.dumps(last, indent=4), port=str(server.port), transport_proto="udp")
        data = {"containers": [{"awg": awg, "container": self._container}], "defaultContainer": self._container,
                "description": name, "dns1": dns_list[0], "dns2": dns_list[-1], "hostName": host}
        raw = json.dumps(data).encode()
        packed = len(raw).to_bytes(4, "big") + zlib.compress(raw, 8)
        return "vpn://" + base64.urlsafe_b64encode(packed).decode().rstrip("=")

    @staticmethod
    def _qr(conf: str) -> str:
        img = qrcode.make(conf, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
        buf = io.BytesIO()
        img.save(buf)
        return buf.getvalue().decode()
