from pathlib import Path
from typing import Dict, Any, List

from . import util, validation


def list_tickets(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for ticket_path in validation.collect_ticket_paths(None):
        issues, fm, body = validation.validate_ticket(ticket_path)
        if not fm:
            continue
        if not _passes(fm, filters):
            continue
        last = last_updated(ticket_path.parent)
        rows.append(
            {
                "id": fm.get("id", ""),
                "title": fm.get("title", ""),
                "status": fm.get("status", ""),
                "priority": fm.get("priority", ""),
                "owner": (fm.get("assignment") or {}).get("owner"),
                "mode": (fm.get("assignment") or {}).get("mode"),
                "last_updated": last,
            }
        )
    return rows


def _passes(fm: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    if filters.get("status") and fm.get("status") != filters["status"]:
        return False
    if filters.get("priority") and fm.get("priority") != filters["priority"]:
        return False
    if filters.get("mode") and (fm.get("assignment") or {}).get("mode") != filters["mode"]:
        return False
    if filters.get("owner") and (fm.get("assignment") or {}).get("owner") != filters["owner"]:
        return False
    if filters.get("label"):
        labels = fm.get("labels") or []
        if filters["label"] not in labels:
            return False
    if filters.get("text"):
        text = filters["text"].lower()
        hay = (fm.get("title", "") + "\n" + fm.get("description", "")).lower()
        if text not in hay:
            return False
    return True


def last_updated(ticket_dir: Path) -> str:
    logs_dir = ticket_dir / "logs"
    latest = ""
    if logs_dir.exists():
        for log_file in logs_dir.glob("*.jsonl"):
            for entry in util.read_jsonl(log_file):
                ts = entry.get("ts")
                if ts and (latest == "" or ts > latest):
                    latest = ts
    return latest
