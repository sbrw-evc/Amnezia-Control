import re

IP_RE = re.compile(r"\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?")
HOST_RE = re.compile(r"(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]")
