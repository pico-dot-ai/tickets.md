from __future__ import annotations
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

import yaml

from . import util, validation


def load_issues_file(path: Path) -> Dict[str, Any]:
    return yaml.safe_load(path.read_text()) or {}


def apply_repairs(repairs: List[Dict[str, Any]], non_interactive: bool = False, include_optional: bool = False) -> List[str]:
    applied = []
    for rep in repairs:
        if rep.get("optional") and not include_optional:
            continue
        if not rep.get("enabled"):
            continue
        action = rep.get("action")
        params = rep.get("params", {})
        ticket_path = Path(rep.get("ticket_path", ""))

        if action == "set_front_matter_field":
            field = params.get("field")
            value = params.get("value")
            if value is None and params.get("generate_uuidv7"):
                value = util.new_uuidv7()
            if value is None:
                if non_interactive:
                    raise RuntimeError(f"Repair needs value for {field}")
                value = input(f"Value for {field}: ").strip()
            _set_front_matter_field(ticket_path, field, value)
            applied.append(f"{ticket_path}: set {field}")

        elif action == "add_sections":
            _add_missing_sections(ticket_path)
            applied.append(f"{ticket_path}: added missing sections")

        elif action == "normalize_created_at":
            _normalize_created_at(ticket_path)
            applied.append(f"{ticket_path}: normalized created_at")

        elif action == "normalize_labels":
            _normalize_labels(ticket_path)
            applied.append(f"{ticket_path}: normalized labels")

        elif action == "set_assignment_owner":
            _set_assignment_owner(ticket_path, params.get("value"))
            applied.append(f"{ticket_path}: set assignment.owner")

        elif action == "reset_verification_commands":
            _reset_verification_commands(ticket_path, params.get("commands", []))
            applied.append(f"{ticket_path}: reset verification.commands")

        elif action == "normalize_verification_commands":
            _normalize_verification_commands(ticket_path)
            applied.append(f"{ticket_path}: normalized verification.commands")

        else:
            if non_interactive:
                raise RuntimeError(f"Unsupported repair action {action}")
    return applied


def run_interactive(repairs: List[Dict[str, Any]], include_optional: bool = False) -> List[str]:
    """
    Step through repairs, explain them, allow user to confirm/apply and supply values.
    Returns list of applied changes (same shape as apply_repairs).
    """
    prepared = []
    for rep in repairs:
        if rep.get("optional") and not include_optional:
            continue
        desc, default_value = _describe_repair(rep)
        print(f"\nRepair {rep.get('id')}: {desc}")
        apply_choice = _prompt_yes_no("Apply this repair?", default=True)
        if not apply_choice:
            continue
        # enable and fill values if needed
        rep["enabled"] = True
        action = rep.get("action")
        params = rep.get("params", {})
        if action == "set_front_matter_field":
            field = params.get("field")
            suggested = default_value
            value = _prompt_value_for_field(field, rep.get("ticket_path"), suggested)
            params["value"] = value
            rep["params"] = params
        elif action == "set_assignment_owner":
            value = _prompt_value_for_field("assignment.owner", rep.get("ticket_path"), default_value)
            params["value"] = value
            rep["params"] = params
        elif action == "reset_verification_commands":
            value = _prompt_commands(default_value or [])
            params["commands"] = value
            rep["params"] = params
        elif action == "normalize_verification_commands":
            # no extra input, but keep enabled
            pass
        prepared.append(rep)
    # apply with non_interactive=True because choices/values already captured
    return apply_repairs(prepared, non_interactive=True, include_optional=include_optional)


def _describe_repair(rep: Dict[str, Any]) -> Tuple[str, Optional[Any]]:
    action = rep.get("action")
    field = (rep.get("params") or {}).get("field")
    path = rep.get("ticket_path", "")
    default = (rep.get("params") or {}).get("value")
    if action == "add_sections":
        return (f"Add missing required sections to {path}.", None)
    if action == "normalize_created_at":
        return (f"Normalize created_at to ISO8601 UTC in {path}.", util.iso8601(util.now_utc()))
    if action == "set_front_matter_field":
        if field == "id":
            return ("Set ticket id to a valid UUIDv7 (used to identify the ticket).", util.new_uuidv7())
        if field == "version":
            return ("Set format version (integer, current 1).", util.FORMAT_VERSION)
        if field == "version_url":
            return ("Set version_url (path to the format definition for this version).", util.FORMAT_VERSION_URL)
        if field == "priority":
            return ("Set priority (low|medium|high|critical).", "medium")
        if field == "labels":
            return ("Reset labels to a list of strings (comma-separated).", [])
        return (f"Set front matter field '{field}'.", default)
    if action == "normalize_labels":
        return ("Normalize labels to strings, dropping invalid entries.", None)
    if action == "set_assignment_owner":
        return ("Set assignment.owner (who owns this ticket; freeform handle).", default)
    if action == "reset_verification_commands":
        return ("Set verification.commands (commands to verify acceptance).", default or [])
    if action == "normalize_verification_commands":
        return ("Normalize verification.commands to strings, dropping invalid entries.", None)
    return ("Apply repair", default)


def _prompt_yes_no(message: str, default: bool = True) -> bool:
    prompt = " [Y/n] " if default else " [y/N] "
    while True:
        resp = input(message + prompt).strip().lower()
        if not resp:
            return default
        if resp in ["y", "yes"]:
            return True
        if resp in ["n", "no"]:
            return False
        print("Please enter y or n.")


def _prompt_value_for_field(field: str, ticket_path: str | None, default: Any) -> Any:
    current = None
    if ticket_path:
        try:
            fm, _ = util.load_ticket(Path(ticket_path))
            if field == "assignment.owner":
                current = (fm.get("assignment") or {}).get("owner")
            else:
                current = fm.get(field)
        except Exception:
            current = None
    if field == "labels":
        return _prompt_labels(default if default is not None else (current if current is not None else []))
    if field == "priority":
        choices = ["low", "medium", "high", "critical"]
        default_val = default or current or "medium"
        while True:
            resp = input(f"Priority [{default_val}]: ").strip().lower()
            if not resp:
                return default_val
            if resp in choices:
                return resp
            print(f"Enter one of {choices}.")
    value_default = default if default is not None else current
    resp = input(f"{field} [{value_default if value_default is not None else ''}]: ").strip()
    if resp == "" and value_default is not None:
        return value_default
    if field == "id":
        return resp or util.new_uuidv7()
    return resp if resp != "" else value_default


def _prompt_labels(default_labels: List[str]) -> List[str]:
    existing = ", ".join(default_labels) if default_labels else ""
    resp = input(f"Labels (comma-separated) [{existing}]: ").strip()
    if not resp:
        return default_labels
    return [s.strip() for s in resp.split(",") if s.strip()]


def _prompt_commands(default_commands: List[str]) -> List[str]:
    existing = "; ".join(default_commands) if default_commands else ""
    print("Enter verification commands (comma-separated). Leave blank to keep default.")
    resp = input(f"Commands [{existing}]: ").strip()
    if not resp:
        return default_commands
    return [s.strip() for s in resp.split(",") if s.strip()]


def _set_front_matter_field(ticket_path: Path, field: str, value: Any):
    fm, body = util.load_ticket(ticket_path)
    fm[field] = value
    util.write_ticket(ticket_path, fm, body)


def _add_missing_sections(ticket_path: Path):
    fm, body = util.load_ticket(ticket_path)
    sections = ["# Ticket", "## Description", "## Acceptance Criteria", "## Verification"]
    new_body = body
    for sec in sections:
        if sec not in new_body:
            new_body += f"\n{sec}\n(fill in)\n"
    util.write_ticket(ticket_path, fm, new_body)


def _normalize_created_at(ticket_path: Path):
    fm, body = util.load_ticket(ticket_path)
    val = fm.get("created_at")
    if not isinstance(val, str) or util.parse_iso(val) is None:
        fm["created_at"] = util.iso8601(util.now_utc())
        util.write_ticket(ticket_path, fm, body)


def _normalize_labels(ticket_path: Path):
    fm, body = util.load_ticket(ticket_path)
    labels = fm.get("labels")
    normalized = [v for v in labels if isinstance(v, str)] if isinstance(labels, list) else []
    fm["labels"] = normalized
    util.write_ticket(ticket_path, fm, body)


def _set_assignment_owner(ticket_path: Path, value: Any):
    fm, body = util.load_ticket(ticket_path)
    assignment = fm.get("assignment") if isinstance(fm.get("assignment"), dict) else {}
    assignment["owner"] = value
    fm["assignment"] = assignment
    util.write_ticket(ticket_path, fm, body)


def _reset_verification_commands(ticket_path: Path, commands: List[str]):
    fm, body = util.load_ticket(ticket_path)
    fm["verification"] = {"commands": commands}
    util.write_ticket(ticket_path, fm, body)


def _normalize_verification_commands(ticket_path: Path):
    fm, body = util.load_ticket(ticket_path)
    ver = fm.get("verification") if isinstance(fm.get("verification"), dict) else {}
    cmds_raw = ver.get("commands") if isinstance(ver, dict) else None
    cmds = [c for c in cmds_raw if isinstance(c, str)] if isinstance(cmds_raw, list) else []
    fm["verification"] = {"commands": cmds}
    util.write_ticket(ticket_path, fm, body)
