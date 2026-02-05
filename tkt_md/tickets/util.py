from __future__ import annotations
import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

import yaml
from uuid6 import uuid7, UUID

# Paths

BASE_DIR = "tkt_md"
FORMAT_VERSION = 1
FORMAT_VERSION_URL = "version/20260205_tkt_md_spec.md"


def repo_root() -> Path:
    return Path.cwd()


def tickets_dir() -> Path:
    return repo_root() / ".tickets"


# Time helpers

def now_utc() -> dt.datetime:
    return dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc)


def iso8601(ts: dt.datetime) -> str:
    return ts.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def iso_basic(ts: dt.datetime) -> str:
    ms = int(ts.microsecond / 1000)
    return ts.strftime("%Y%m%dT%H%M%S") + f".{ms:03d}Z"


def parse_iso(s: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# UUID helpers

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def is_uuidv7(value: str) -> bool:
    if not isinstance(value, str) or not UUID_RE.match(value):
        return False
    try:
        u = UUID(value)
    except Exception:
        return False
    return u.version == 7


def new_uuidv7() -> str:
    return str(uuid7())


# YAML front matter utilities

def load_ticket(path: Path) -> tuple[Dict[str, Any], str]:
    text = path.read_text()
    if not text.startswith("---"):
        raise ValueError("Missing front matter start '---'")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("Malformed front matter")
    fm_text = parts[1]
    body = parts[2].lstrip("\n")
    data = yaml.safe_load(fm_text) or {}
    return data, body


def write_ticket(path: Path, front_matter: Dict[str, Any], body: str):
    fm_text = yaml.safe_dump(front_matter, sort_keys=False).rstrip()
    out = ["---", fm_text, "---", body.strip() + "\n"]
    path.write_text("\n".join(out))


# JSONL utilities

def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    entries = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entries.append(json.loads(line))
    return entries


def append_jsonl(path: Path, obj: Dict[str, Any]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(obj, separators=(",", ":")) + "\n")


# File discovery

def list_ticket_dirs() -> List[Path]:
    root = tickets_dir()
    if not root.exists():
        return []
    return sorted([p for p in root.iterdir() if p.is_dir()])


# Filename checks

RUN_FILE_RE = re.compile(r"^[0-9T:\.]+Z-[A-Za-z0-9_\-]+\.jsonl$")


def matches_run_filename(name: str) -> bool:
    return bool(RUN_FILE_RE.match(name))


def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)
