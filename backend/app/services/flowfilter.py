from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass

from ..domain.errors import DomainError

PROTOCOLS = {"icmp": 1, "tcp": 6, "udp": 17, "gre": 47, "esp": 50, "ah": 51, "sctp": 132}
SITES_DICT = "flows.sites"


@dataclass(frozen=True)
class Field:
    name: str
    kind: str
    column: str
    label: str
    dimension: str


FIELDS: dict[str, Field] = {f.name.lower(): f for f in (
    Field("Direction", "enum", "Direction", "Направление", "toString(Direction)"),
    Field("Route", "enum", "Route", "Маршрут", "toString(Route)"),
    Field("LocalAddr", "ip", "LocalAddr", "Локальный адрес", "IPv4NumToString(LocalAddr)"),
    Field("RemoteAddr", "ip", "RemoteAddr", "Удалённый адрес", "IPv4NumToString(RemoteAddr)"),
    Field("RemoteNet", "ip", "RemoteAddr", "Удалённая сеть /24",
          "concat(IPv4NumToString(IPv4CIDRToRange(RemoteAddr, 24).1), '/24')"),
    Field("RemoteAS", "asn", "RemoteAS", "AS", "concat('AS', toString(RemoteAS), ' ', RemoteASName)"),
    Field("RemoteASName", "string", "RemoteASName", "Организация AS", "RemoteASName"),
    Field("RemoteCountry", "string", "RemoteCountry", "Страна", "RemoteCountry"),
    Field("Site", "string", f"dictGetOrDefault('{SITES_DICT}', 'site', tuple(RemoteAddr), '')", "Сайт",
          f"dictGetOrDefault('{SITES_DICT}', 'site', tuple(RemoteAddr), '—')"),
    Field("SiteGroup", "string", f"dictGetOrDefault('{SITES_DICT}', 'grp', tuple(RemoteAddr), '')", "Группа сайтов",
          f"dictGetOrDefault('{SITES_DICT}', 'grp', tuple(RemoteAddr), '—')"),
    Field("Proto", "proto", "Proto", "Протокол",
          "transform(Proto, [1, 6, 17, 47, 50, 51, 132], ['ICMP', 'TCP', 'UDP', 'GRE', 'ESP', 'AH', 'SCTP'], toString(Proto))"),
    Field("LocalPort", "port", "LocalPort", "Локальный порт", "toString(LocalPort)"),
    Field("RemotePort", "port", "RemotePort", "Удалённый порт", "toString(RemotePort)"),
)}

TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<lcomment>--[^\n]*)
  | (?P<bcomment>/\*.*?\*/)
  | (?P<lp>\() | (?P<rp>\)) | (?P<comma>,)
  | (?P<op><=|>=|!=|=|<|>)
  | (?P<str>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")
  | (?P<word>[A-Za-z0-9_.:/%*\-]+)
""", re.X | re.S)
KEYWORDS = {"and", "or", "not", "in", "notin", "like", "unlike", "ilike", "iunlike"}


class FilterParser:
    def __init__(self, text: str):
        self._tokens = self._lex(text or "")
        self._pos = 0
        self.params: dict[str, object] = {}

    @staticmethod
    def _lex(text: str) -> list[tuple[str, str]]:
        out, i = [], 0
        while i < len(text):
            m = TOKEN.match(text, i)
            if not m:
                raise DomainError(f"Фильтр: неожиданный символ «{text[i]}» в позиции {i + 1}")
            i = m.end()
            kind = m.lastgroup
            if kind in ("ws", "lcomment", "bcomment"):
                continue
            value = m.group()
            if kind == "word" and value.lower() in KEYWORDS:
                kind = value.lower()
            elif kind == "str":
                value = re.sub(r"\\(.)", r"\1", value[1:-1])
            out.append((kind, value))
        return out

    def compile(self) -> str:
        if not self._tokens:
            return "1"
        sql = self._or()
        if self._pos != len(self._tokens):
            raise DomainError(f"Фильтр: лишний фрагмент «{self._tokens[self._pos][1]}»")
        return sql

    def _peek(self) -> str | None:
        return self._tokens[self._pos][0] if self._pos < len(self._tokens) else None

    def _take(self, kind: str | None = None) -> tuple[str, str]:
        if self._pos >= len(self._tokens):
            raise DomainError("Фильтр: неожиданный конец выражения")
        tok = self._tokens[self._pos]
        if kind and tok[0] != kind:
            raise DomainError(f"Фильтр: ожидалось {kind}, получено «{tok[1]}»")
        self._pos += 1
        return tok

    def _or(self) -> str:
        parts = [self._and()]
        while self._peek() == "or":
            self._take()
            parts.append(self._and())
        return parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"

    def _and(self) -> str:
        parts = [self._not()]
        while self._peek() == "and":
            self._take()
            parts.append(self._not())
        return parts[0] if len(parts) == 1 else "(" + " AND ".join(parts) + ")"

    def _not(self) -> str:
        if self._peek() == "not":
            self._take()
            return f"NOT ({self._not()})"
        if self._peek() == "lp":
            self._take()
            inner = self._or()
            self._take("rp")
            return f"({inner})"
        return self._comparison()

    def _param(self, value: object, ch_type: str) -> str:
        name = f"f{len(self.params)}"
        self.params[name] = value
        return f"{{{name}:{ch_type}}}"

    def _comparison(self) -> str:
        _, name = self._take("word")
        field = FIELDS.get(name.lower())
        if not field:
            raise DomainError(f"Фильтр: неизвестное поле «{name}». Доступны: {', '.join(f.name for f in FIELDS.values())}")
        op_kind, op = self._take()
        if op_kind in ("in", "notin"):
            self._take("lp")
            values = [self._value()]
            while self._peek() == "comma":
                self._take()
                values.append(self._value())
            self._take("rp")
            parts = [self._single(field, "=", v) for v in values]
            joined = " OR ".join(parts)
            return f"({joined})" if op_kind == "in" else f"NOT ({joined})"
        if op_kind in ("like", "unlike", "ilike", "iunlike"):
            if field.kind not in ("string", "enum"):
                raise DomainError(f"Фильтр: {op.upper()} применим только к строковым полям")
            fn = "ilike" if op_kind.startswith("i") else "like"
            expr = f"{fn}(toString({field.column}), {self._param(self._value(), 'String')})"
            return expr if op_kind in ("like", "ilike") else f"NOT {expr}"
        if op_kind != "op":
            raise DomainError(f"Фильтр: ожидался оператор после {field.name}")
        return self._single(field, op, self._value())

    def _value(self) -> str:
        kind, value = self._take()
        if kind not in ("word", "str"):
            raise DomainError(f"Фильтр: ожидалось значение, получено «{value}»")
        return value

    def _single(self, field: Field, op: str, value: str) -> str:
        if field.kind == "ip":
            try:
                net = ipaddress.ip_network(value, strict=False)
            except ValueError:
                raise DomainError(f"Фильтр: «{value}» не IPv4-адрес или подсеть")
            if op not in ("=", "!="):
                raise DomainError("Фильтр: для адресов доступны только = и !=")
            expr = (f"isIPAddressInRange(IPv4NumToString({field.column}), {self._param(str(net), 'String')})"
                    if net.prefixlen < 32 else f"{field.column} = toIPv4({self._param(str(net.network_address), 'String')})")
            return expr if op == "=" else f"NOT ({expr})"
        if field.kind in ("asn", "port", "proto"):
            raw = value.lower()
            if field.kind == "asn":
                raw = raw.removeprefix("as")
            if field.kind == "proto" and raw in PROTOCOLS:
                raw = str(PROTOCOLS[raw])
            if not raw.isdigit():
                raise DomainError(f"Фильтр: «{value}» должно быть числом для {field.name}")
            return f"{field.column} {op} {self._param(int(raw), 'UInt32')}"
        if op not in ("=", "!="):
            raise DomainError(f"Фильтр: для {field.name} доступны =, !=, LIKE, IN")
        return f"toString({field.column}) {op} {self._param(value, 'String')}"


def dimension(name: str) -> Field:
    f = FIELDS.get(name.lower())
    if not f:
        raise DomainError(f"Неизвестное измерение {name}")
    return f
