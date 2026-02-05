from __future__ import annotations
from pathlib import Path
from typing import List, Dict, Any, Tuple

from . import util


def _parse_version(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        v = value.strip()
        if v.isdigit():
            return int(v)
    return None


def collect_ticket_paths(target: str | None) -> List[Path]:
    if target:
        p = Path(target)
        if p.is_dir():
            return [p / "ticket.md"]
        else:
            return [p]
    return [p / "ticket.md" for p in util.list_ticket_dirs() if (p / "ticket.md").exists()]


def validate_ticket(path: Path, all_fields: bool = False) -> Tuple[List[Dict[str, Any]], Dict[str, Any], str]:
    issues: List[Dict[str, Any]] = []
    try:
        fm, body = util.load_ticket(path)
    except Exception as exc:
        issues.append({"severity": "error", "code": "TICKET_FRONT_MATTER_INVALID", "message": str(exc), "ticket_path": str(path)})
        return issues, {}, ""

    required_fields = ["id", "title", "status", "created_at"]
    for field in required_fields:
        if field not in fm:
            issues.append({"severity": "error", "code": f"MISSING_{field.upper()}", "message": f"Missing {field}", "ticket_path": str(path)})

    if "version" not in fm:
        issues.append({"severity": "warning", "code": "VERSION_MISSING", "message": "Missing version (assume 1 for legacy tickets)", "ticket_path": str(path)})
    else:
        ver = _parse_version(fm.get("version"))
        if ver is None or ver <= 0:
            issues.append({"severity": "error", "code": "VERSION_INVALID", "message": "version must be a positive integer", "ticket_path": str(path)})
        if "version_url" not in fm:
            issues.append({"severity": "error", "code": "VERSION_URL_MISSING", "message": "version_url required when version is present", "ticket_path": str(path)})
        elif not isinstance(fm.get("version_url"), str) or not fm.get("version_url").strip():
            issues.append({"severity": "error", "code": "VERSION_URL_INVALID", "message": "version_url must be a non-empty string", "ticket_path": str(path)})

    if "version_url" in fm and "version" not in fm:
        issues.append({"severity": "warning", "code": "VERSION_URL_WITHOUT_VERSION", "message": "version_url present without version", "ticket_path": str(path)})

    if "id" in fm and (not isinstance(fm["id"], str) or not util.is_uuidv7(fm["id"])):
        issues.append({"severity": "error", "code": "ID_NOT_UUIDV7", "message": "id must be UUIDv7", "ticket_path": str(path)})

    if "created_at" in fm:
        ts = fm["created_at"]
        if not isinstance(ts, str) or util.parse_iso(ts) is None:
            issues.append({"severity": "error", "code": "CREATED_AT_INVALID", "message": "created_at must be ISO8601 UTC", "ticket_path": str(path)})

    if "status" in fm and fm["status"] not in ["todo", "doing", "blocked", "done", "canceled"]:
        issues.append({"severity": "error", "code": "STATUS_INVALID", "message": "status invalid", "ticket_path": str(path)})

    if "assignment" in fm:
        if not isinstance(fm["assignment"], dict):
            issues.append({"severity": "error", "code": "ASSIGNMENT_INVALID", "message": "assignment must be mapping", "ticket_path": str(path)})
        else:
            mode = fm["assignment"].get("mode")
            if mode and mode not in ["human_only", "agent_only", "mixed"]:
                issues.append({"severity": "error", "code": "ASSIGNMENT_MODE_INVALID", "message": "assignment.mode invalid", "ticket_path": str(path)})

    if "custom" in fm and not isinstance(fm["custom"], dict):
        issues.append({"severity": "error", "code": "CUSTOM_INVALID", "message": "custom must be mapping", "ticket_path": str(path)})

    relationship_keys = ["dependencies", "blocks", "related"]
    for key in relationship_keys:
        if key in fm:
            val = fm[key]
            if not isinstance(val, list):
                issues.append({"severity": "error", "code": "RELATIONSHIP_TYPE_INVALID", "message": f"{key} must be list", "ticket_path": str(path)})
            else:
                for entry in val:
                    if not isinstance(entry, str) or not util.is_uuidv7(entry):
                        issues.append({"severity": "error", "code": "RELATIONSHIP_ID_INVALID", "message": f"{key} entries must be UUIDv7", "ticket_path": str(path)})
    for forbidden in ["parent", "subtickets", "supersedes", "duplicate_of"]:
        if forbidden in fm:
            issues.append({"severity": "error", "code": "RELATIONSHIP_KEY_FORBIDDEN", "message": f"{forbidden} not allowed in ticket.md", "ticket_path": str(path)})

    if "agent_limits" in fm and isinstance(fm["agent_limits"], dict):
        for k in ["iteration_timebox_minutes", "max_iterations", "max_tool_calls", "checkpoint_every_minutes"]:
            if k in fm["agent_limits"]:
                val = fm["agent_limits"][k]
                if not isinstance(val, int) or val <= 0:
                    issues.append({"severity": "error", "code": "AGENT_LIMIT_VALUE_INVALID", "message": f"{k} must be positive int", "ticket_path": str(path)})
    elif "agent_limits" in fm:
        issues.append({"severity": "error", "code": "AGENT_LIMITS_INVALID", "message": "agent_limits must be mapping", "ticket_path": str(path)})

    if all_fields:
        if "priority" in fm and fm["priority"] not in ["low", "medium", "high", "critical"]:
            issues.append({"severity": "error", "code": "PRIORITY_INVALID", "message": "priority must be low|medium|high|critical", "ticket_path": str(path), "optional": True})
        if "labels" in fm:
            if not isinstance(fm["labels"], list):
                issues.append({"severity": "error", "code": "LABELS_NOT_LIST", "message": "labels must be list of strings", "ticket_path": str(path), "optional": True})
            else:
                for entry in fm["labels"]:
                    if not isinstance(entry, str):
                        issues.append({"severity": "error", "code": "LABEL_INVALID_ENTRY", "message": "labels entries must be strings", "ticket_path": str(path), "optional": True})
        if "assignment" in fm and isinstance(fm["assignment"], dict):
            owner = fm["assignment"].get("owner")
            if owner is not None and not isinstance(owner, str):
                issues.append({"severity": "error", "code": "ASSIGNMENT_OWNER_INVALID", "message": "assignment.owner must be string", "ticket_path": str(path), "optional": True})
        if "verification" in fm:
            ver = fm["verification"]
            if not isinstance(ver, dict):
                issues.append({"severity": "error", "code": "VERIFICATION_INVALID", "message": "verification must be mapping", "ticket_path": str(path), "optional": True})
            else:
                cmds = ver.get("commands")
                if cmds is not None and not isinstance(cmds, list):
                    issues.append({"severity": "error", "code": "VERIFICATION_COMMANDS_INVALID", "message": "verification.commands must be list of strings", "ticket_path": str(path), "optional": True})
                elif isinstance(cmds, list):
                    for entry in cmds:
                        if not isinstance(entry, str):
                            issues.append({"severity": "error", "code": "VERIFICATION_COMMAND_INVALID", "message": "verification.commands entries must be strings", "ticket_path": str(path), "optional": True})

    required_sections = ["# Ticket", "## Description", "## Acceptance Criteria", "## Verification"]
    for heading in required_sections:
        if heading not in body:
            issues.append({"severity": "error", "code": "MISSING_SECTION", "message": f"Missing section {heading}", "ticket_path": str(path)})

    return issues, fm, body


def validate_run_log(path: Path, machine_strict_default: bool) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    filename = path.name
    prefix_expected = None
    if "-" in filename:
        prefix_expected = filename.rsplit(".", 1)[0].split("-", 1)[0]
    entries = util.read_jsonl(path)
    run_started_value = None
    for idx, entry in enumerate(entries):
        loc = f"{path}:{idx+1}"
        machine_entry = machine_strict_default or entry.get("written_by") == "tickets" or entry.get("machine") is True
        for req in ["ts", "run_started", "actor_type", "actor_id", "summary"]:
            if req not in entry:
                sev = "error" if machine_entry else "warning"
                issues.append({"severity": sev, "code": "LOG_FIELD_MISSING", "message": f"{req} missing", "log": loc})
        if "version" not in entry:
            sev = "error" if machine_entry else "warning"
            issues.append({"severity": sev, "code": "LOG_VERSION_MISSING", "message": "version missing (assume 1 for legacy logs)", "log": loc})
        else:
            ver = _parse_version(entry.get("version"))
            if ver is None or ver <= 0:
                sev = "error" if machine_entry else "warning"
                issues.append({"severity": sev, "code": "LOG_VERSION_INVALID", "message": "version must be a positive integer", "log": loc})
            if "version_url" not in entry:
                sev = "error" if machine_entry else "warning"
                issues.append({"severity": sev, "code": "LOG_VERSION_URL_MISSING", "message": "version_url required when version is present", "log": loc})
            elif not isinstance(entry.get("version_url"), str) or not entry.get("version_url").strip():
                sev = "error" if machine_entry else "warning"
                issues.append({"severity": sev, "code": "LOG_VERSION_URL_INVALID", "message": "version_url must be a non-empty string", "log": loc})
        if "ts" in entry and util.parse_iso(entry["ts"]) is None:
            sev = "error" if machine_entry else "warning"
            issues.append({"severity": sev, "code": "TS_INVALID", "message": "ts not ISO8601", "log": loc})
        if "run_started" in entry:
            if util.parse_iso(entry["run_started"]) is None:
                sev = "error" if machine_entry else "warning"
                issues.append({"severity": sev, "code": "RUN_STARTED_INVALID", "message": "run_started not ISO8601", "log": loc})
            else:
                if run_started_value is None:
                    run_started_value = entry["run_started"]
                elif entry["run_started"] != run_started_value:
                    issues.append({"severity": "error" if machine_entry else "warning", "code": "RUN_STARTED_INCONSISTENT", "message": "run_started differs within file", "log": loc})
                if prefix_expected and not entry["run_started"].replace(":", "").startswith(prefix_expected.replace(":", "")):
                    issues.append({"severity": "warning", "code": "RUN_STARTED_FILENAME_MISMATCH", "message": "run_started mismatch filename prefix", "log": loc})
        if "actor_type" in entry and entry.get("actor_type") not in ["human", "agent"]:
            sev = "error" if machine_entry else "warning"
            issues.append({"severity": sev, "code": "ACTOR_TYPE_INVALID", "message": "actor_type must be human|agent", "log": loc})
        if machine_entry and not (entry.get("written_by") == "tickets" or entry.get("machine") is True):
            issues.append({"severity": "error", "code": "MACHINE_MARKER_MISSING", "message": "machine marker required", "log": loc})
        if "custom" in entry and not isinstance(entry["custom"], dict):
            sev = "error" if machine_entry else "warning"
            issues.append({"severity": sev, "code": "LOG_CUSTOM_INVALID", "message": "custom must be mapping", "log": loc})
    return issues
