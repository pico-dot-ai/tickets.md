from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import yaml

from . import templates, util, validation, repair, listing


def main(argv=None):
    argv = argv or sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


def build_parser():
    p = argparse.ArgumentParser(prog="tickets", description="Repo-native ticketing CLI")
    sub = p.add_subparsers(dest="command", required=True)

    # init
    sp = sub.add_parser("init", help="Initialize tickets structure")
    sp.add_argument("--examples", action="store_true", help="Generate example tickets and logs")
    sp.set_defaults(func=cmd_init)

    # new
    sp = sub.add_parser("new", help="Create new ticket")
    sp.add_argument("--title", required=True)
    sp.add_argument("--status", choices=["todo", "doing", "blocked", "done", "canceled"], default="todo")
    sp.add_argument("--priority", choices=["low", "medium", "high", "critical"])
    sp.add_argument("--label", action="append", dest="labels")
    sp.add_argument("--assignment-mode", choices=["human_only", "agent_only", "mixed"])
    sp.add_argument("--assignment-owner")
    sp.add_argument("--dependency", action="append", dest="dependencies")
    sp.add_argument("--block", action="append", dest="blocks")
    sp.add_argument("--related", action="append")
    sp.add_argument("--iteration-timebox-minutes", type=int)
    sp.add_argument("--max-iterations", type=int)
    sp.add_argument("--max-tool-calls", type=int)
    sp.add_argument("--checkpoint-every-minutes", type=int)
    sp.add_argument("--verification-command", action="append", dest="verification_commands")
    sp.add_argument("--created-at")
    sp.set_defaults(func=cmd_new)

    # validate
    sp = sub.add_parser("validate", help="Validate tickets")
    sp.add_argument("--ticket", help="Ticket id or path")
    sp.add_argument("--issues", action="store_true", help="Output machine-readable issues/repairs")
    sp.add_argument("--output", help="Output path for issues report")
    sp.add_argument("--all-fields", action="store_true", help="Validate optional front-matter fields too")
    sp.set_defaults(func=cmd_validate)

    # status
    sp = sub.add_parser("status", help="Update ticket status")
    sp.add_argument("--ticket", required=True)
    sp.add_argument("--status", required=True, choices=["todo", "doing", "blocked", "done", "canceled"])
    sp.add_argument("--log", action="store_true", help="Write a status-change log entry")
    sp.add_argument("--run-id")
    sp.add_argument("--run-started")
    sp.set_defaults(func=cmd_status)

    # log
    sp = sub.add_parser("log", help="Append a run log entry")
    sp.add_argument("--ticket", required=True)
    sp.add_argument("--run-id")
    sp.add_argument("--run-started")
    sp.add_argument("--actor-type", required=True, choices=["human", "agent"])
    sp.add_argument("--actor-id", required=True)
    sp.add_argument("--summary", required=True)
    sp.add_argument("--machine", action="store_true")
    sp.add_argument("--changes", nargs="*")
    sp.add_argument("--decisions", nargs="*")
    sp.add_argument("--next-steps", nargs="*")
    sp.add_argument("--blockers", nargs="*")
    sp.add_argument("--tickets-created", nargs="*")
    sp.add_argument("--created-from")
    sp.add_argument("--context-carried-over", nargs="*")
    sp.add_argument("--verification-commands", nargs="*")
    sp.add_argument("--verification-results")
    sp.set_defaults(func=cmd_log)

    # list
    sp = sub.add_parser("list", help="List tickets")
    sp.add_argument("--status")
    sp.add_argument("--priority")
    sp.add_argument("--mode")
    sp.add_argument("--owner")
    sp.add_argument("--label")
    sp.add_argument("--text")
    sp.add_argument("--json", dest="json_out", action="store_true")
    sp.set_defaults(func=cmd_list)

    # repair
    sp = sub.add_parser("repair", help="Repair tickets")
    sp.add_argument("--ticket")
    sp.add_argument("--all", action="store_true")
    sp.add_argument("--issues-file")
    sp.add_argument("--interactive", action="store_true")
    sp.add_argument("--non-interactive", action="store_true")
    sp.add_argument("--all-fields", action="store_true", help="Repair optional front-matter fields too")
    sp.set_defaults(func=cmd_repair)

    # graph (optional placeholder)
    sp = sub.add_parser("graph", help="Dependency graph")
    sp.add_argument("--ticket", help="Limit to a ticket id/path")
    sp.add_argument("--format", choices=["mermaid", "dot", "json"], default="mermaid")
    sp.add_argument("--output", help="Output file path (overrides default location)")
    sp.add_argument("--include-related", action="store_true", default=True)
    sp.add_argument("--no-related", dest="include_related", action="store_false")
    sp.set_defaults(func=cmd_graph)

    return p


# Commands


def cmd_init(args):
    util.ensure_dir(util.tickets_dir())
    base_dir = util.repo_root() / util.BASE_DIR
    util.ensure_dir(base_dir)
    # TICKETS.md
    tm = util.repo_root() / "TICKETS.md"
    if not tm.exists():
        tm.write_text(templates.TICKETS_MD_TEMPLATE)
    # AGENTS_EXAMPLE.md
    am = base_dir / "AGENTS_EXAMPLE.md"
    if not am.exists():
        am.write_text(templates.AGENTS_EXAMPLE_TEMPLATE)
    # version
    version_dir = base_dir / "version"
    util.ensure_dir(version_dir)
    spec_path = version_dir / "20260205_tkt_md_spec.md"
    if not spec_path.exists():
        spec_path.write_text(templates.VERSION_SPEC_TEMPLATE)
    proposed_path = version_dir / "PROPOSED_tkt_md_spec.md"
    if not proposed_path.exists():
        proposed_path.write_text(templates.PROPOSED_SPEC_TEMPLATE)
    if args.examples:
        generate_example_tickets()
    print("Initialized.")
    return 0


def cmd_new(args):
    util.ensure_dir(util.tickets_dir())
    ticket_id = util.new_uuidv7().lower()
    tdir = util.tickets_dir() / ticket_id
    util.ensure_dir(tdir / "logs")
    fm = {
        "id": ticket_id,
        "version": util.FORMAT_VERSION,
        "version_url": util.FORMAT_VERSION_URL,
        "title": args.title,
        "status": args.status,
        "created_at": args.created_at or util.iso8601(util.now_utc()),
    }
    if args.priority:
        fm["priority"] = args.priority
    if args.labels:
        fm["labels"] = args.labels
    if args.assignment_mode or args.assignment_owner:
        fm["assignment"] = {"mode": args.assignment_mode, "owner": args.assignment_owner}
    for key, val in [("dependencies", args.dependencies), ("blocks", args.blocks), ("related", args.related)]:
        if val:
            fm[key] = val
    agent_limits = {}
    if args.iteration_timebox_minutes:
        agent_limits["iteration_timebox_minutes"] = args.iteration_timebox_minutes
    if args.max_iterations:
        agent_limits["max_iterations"] = args.max_iterations
    if args.max_tool_calls:
        agent_limits["max_tool_calls"] = args.max_tool_calls
    if args.checkpoint_every_minutes:
        agent_limits["checkpoint_every_minutes"] = args.checkpoint_every_minutes
    if agent_limits:
        fm["agent_limits"] = agent_limits
    if args.verification_commands:
        fm["verification"] = {"commands": args.verification_commands}
    body = templates.TICKET_TEMPLATE_BODY
    util.write_ticket(tdir / "ticket.md", fm, body)
    print(ticket_id)
    return 0


def cmd_validate(args):
    tickets = validation.collect_ticket_paths(args.ticket)
    issues_all: List[Dict[str, Any]] = []
    for tpath in tickets:
        issues, fm, body = validation.validate_ticket(tpath, all_fields=args.all_fields)
        issues_all.extend(issues)
        logs_dir = tpath.parent / "logs"
        if logs_dir.exists():
            for log_file in sorted(logs_dir.glob("*.jsonl")):
                issues_all.extend(validation.validate_run_log(log_file, machine_strict_default=False))
    # assign deterministic ids
    for idx, issue in enumerate(issues_all, start=1):
        issue.setdefault("id", f"I{idx:04d}")
    if args.issues:
        report = {
            "schema_version": 1,
            "generated_at": util.iso8601(util.now_utc()),
            "tool": "tickets",
            "targets": [str(p) for p in tickets],
            "issues": issues_all,
            "repairs": build_repairs_from_issues(issues_all, include_optional=args.all_fields),
        }
        out = yaml.safe_dump(report, sort_keys=False)
        if args.output:
            Path(args.output).write_text(out)
        else:
            sys.stdout.write(out)
    else:
        for issue in issues_all:
            print(f"{issue.get('severity','?').upper()}: {issue.get('message')} ({issue.get('ticket_path') or issue.get('log')})")
    return 0 if not [i for i in issues_all if i["severity"] == "error"] else 1


def build_repairs_from_issues(issues: List[Dict[str, Any]], include_optional: bool = False, auto_enable_safe: bool = False) -> List[Dict[str, Any]]:
    repairs = []
    seen = set()
    optional_codes = {
        "PRIORITY_INVALID",
        "LABELS_NOT_LIST",
        "LABEL_INVALID_ENTRY",
        "ASSIGNMENT_OWNER_INVALID",
        "VERIFICATION_INVALID",
        "VERIFICATION_COMMANDS_INVALID",
        "VERIFICATION_COMMAND_INVALID",
    }
    for issue in issues:
        code = issue.get("code")
        path = issue.get("ticket_path")
        if not path:
            continue
        key = (code, path)
        if key in seen:
            continue
        seen.add(key)
        is_optional = code in optional_codes
        if is_optional and not include_optional:
            continue
        if code in ["MISSING_SECTION"]:
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "add_sections", "ticket_path": path, "params": {}, "optional": False}
            )
        elif code in ["VERSION_MISSING", "VERSION_INVALID"]:
            repairs.append(
                {
                    "id": f"R{len(repairs)+1:04d}",
                    "enabled": False,
                    "safe": True,
                    "issue_ids": [issue.get("id", "")],
                    "action": "set_front_matter_field",
                    "ticket_path": path,
                    "params": {"field": "version", "value": util.FORMAT_VERSION},
                    "optional": False,
                }
            )
        elif code in ["VERSION_URL_MISSING", "VERSION_URL_INVALID"]:
            repairs.append(
                {
                    "id": f"R{len(repairs)+1:04d}",
                    "enabled": False,
                    "safe": True,
                    "issue_ids": [issue.get("id", "")],
                    "action": "set_front_matter_field",
                    "ticket_path": path,
                    "params": {"field": "version_url", "value": util.FORMAT_VERSION_URL},
                    "optional": False,
                }
            )
        elif code in ["CREATED_AT_INVALID", "MISSING_CREATED_AT"]:
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "normalize_created_at", "ticket_path": path, "params": {}, "optional": False}
            )
        elif code in ["ID_NOT_UUIDV7", "MISSING_ID"]:
            repairs.append(
                {
                    "id": f"R{len(repairs)+1:04d}",
                    "enabled": False,
                    "safe": False,
                    "issue_ids": [issue.get("id", "")],
                    "action": "set_front_matter_field",
                    "ticket_path": path,
                    "params": {"field": "id", "value": None, "generate_uuidv7": True, "update_references": None},
                    "optional": False,
                }
            )
        elif code == "PRIORITY_INVALID":
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "set_front_matter_field", "ticket_path": path, "params": {"field": "priority", "value": "medium"}, "optional": True}
            )
        elif code == "LABELS_NOT_LIST":
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "set_front_matter_field", "ticket_path": path, "params": {"field": "labels", "value": []}, "optional": True}
            )
        elif code == "LABEL_INVALID_ENTRY":
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "normalize_labels", "ticket_path": path, "params": {}, "optional": True}
            )
        elif code == "ASSIGNMENT_OWNER_INVALID":
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "set_assignment_owner", "ticket_path": path, "params": {"value": None}, "optional": True}
            )
        elif code == "VERIFICATION_INVALID":
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "reset_verification_commands", "ticket_path": path, "params": {"commands": []}, "optional": True}
            )
        elif code in ["VERIFICATION_COMMANDS_INVALID", "VERIFICATION_COMMAND_INVALID"]:
            repairs.append(
                {"id": f"R{len(repairs)+1:04d}", "enabled": False, "safe": True, "issue_ids": [issue.get("id", "")], "action": "normalize_verification_commands", "ticket_path": path, "params": {}, "optional": True}
            )
    for rep in repairs:
        if auto_enable_safe and rep.get("safe"):
            rep["enabled"] = True
    return repairs


def load_ticket_graph(ticket_ref: str | None) -> Dict[str, Any]:
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, str]] = []
    paths = validation.collect_ticket_paths(ticket_ref)
    root_id = None
    for tpath in paths:
        fm, body = util.load_ticket(tpath)
        tid = fm.get("id")
        if not tid:
            continue
        if ticket_ref and root_id is None:
            root_id = tid
        nodes.setdefault(
            tid,
            {
                "id": tid,
                "title": fm.get("title", ""),
                "status": fm.get("status", ""),
                "priority": fm.get("priority"),
                "owner": (fm.get("assignment") or {}).get("owner"),
                "mode": (fm.get("assignment") or {}).get("mode"),
                "path": str(tpath),
            },
        )
        for dep in fm.get("dependencies", []) or []:
            nodes.setdefault(dep, _load_node(dep))
            edges.append({"type": "dependency", "from": dep, "to": tid})
        for blk in fm.get("blocks", []) or []:
            nodes.setdefault(blk, _load_node(blk))
            edges.append({"type": "blocks", "from": tid, "to": blk})
        for rel in fm.get("related", []) or []:
            nodes.setdefault(rel, _load_node(rel))
            edges.append({"type": "related", "from": tid, "to": rel})
    return {"nodes": list(nodes.values()), "edges": edges, "root_id": root_id}


def _load_node(ticket_id: str) -> Dict[str, Any]:
    """
    Best-effort load of a ticket by id to populate title/status.
    Falls back to placeholders if the file is missing or unreadable.
    """
    tpath = util.tickets_dir() / ticket_id / "ticket.md"
    if tpath.exists():
        try:
            fm, _ = util.load_ticket(tpath)
            return {
                "id": ticket_id,
                "title": fm.get("title", ticket_id),
                "status": fm.get("status", ""),
                "priority": fm.get("priority"),
                "owner": (fm.get("assignment") or {}).get("owner"),
                "mode": (fm.get("assignment") or {}).get("mode"),
                "path": str(tpath),
            }
        except Exception:
            pass
    return {"id": ticket_id, "title": ticket_id, "status": "", "path": f"/.tickets/{ticket_id}/ticket.md"}


def render_mermaid(graph: Dict[str, Any], include_related: bool, timestamp: str) -> str:
    status_classes = {
        "todo": "fill:#ddd,stroke:#999",
        "doing": "fill:#d0e7ff,stroke:#3b82f6",
        "blocked": "fill:#ffe4e6,stroke:#ef4444",
        "done": "fill:#dcfce7,stroke:#22c55e",
        "canceled": "fill:#f3f4f6,stroke:#111827,color:#374151",
    }
    lines = []
    lines.append("# Ticket dependency graph")
    lines.append(f"_Generated at {timestamp} UTC_")
    lines.append("")
    lines.append("```mermaid")
    lines.append("graph LR")
    node_ids: Dict[str, str] = {}
    for idx, n in enumerate(graph["nodes"]):
        nid = f"n{idx}"
        node_ids[n["id"]] = nid
        label = (n.get("title") or n["id"]).replace('"', '\\"')
        label = f"{label}\\n({n['id']})"
        status = (n.get("status") or "todo").lower()
        lines.append(f'  {nid}["{label}"]:::status_{status}')
        lines.append(f'  click {nid} "/.tickets/{n["id"]}/ticket.md" "_blank"')
    for edge in graph["edges"]:
        if edge["type"] == "related" and not include_related:
            continue
        src = node_ids.get(edge["from"])
        dst = node_ids.get(edge["to"])
        if not src or not dst:
            continue
        arrow = "-->"
        lines.append(f"  {src} {arrow} {dst}")
    # classes
    for status, style in status_classes.items():
        lines.append(f"  classDef status_{status} {style};")
    lines.append("```")
    return "\n".join(lines)


def render_dot(graph: Dict[str, Any], include_related: bool) -> str:
    colors = {
        "todo": "#d1d5db",
        "doing": "#60a5fa",
        "blocked": "#ef4444",
        "done": "#22c55e",
        "canceled": "#6b7280",
    }
    lines = ["digraph G {", '  rankdir=LR;', '  node [shape=box, style=filled, color="#cccccc"];']
    node_ids: Dict[str, str] = {}
    for idx, n in enumerate(graph["nodes"]):
        nid = f"n{idx}"
        node_ids[n["id"]] = nid
        status = (n.get("status") or "todo").lower()
        color = colors.get(status, "#d1d5db")
        label = f"{n.get('title') or n['id']}\\n({n['id']})\\n{status}"
        lines.append(f'  {nid} [label="{label}", fillcolor="{color}", URL="/.tickets/{n["id"]}/ticket.md", target="_blank"];')
    for edge in graph["edges"]:
        if edge["type"] == "related" and not include_related:
            continue
        src = node_ids.get(edge["from"])
        dst = node_ids.get(edge["to"])
        if not src or not dst:
            continue
        style = "dashed" if edge["type"] == "related" else "solid"
        lines.append(f"  {src} -> {dst} [style={style}];")
    lines.append("}")
    return "\n".join(lines)


def render_json(graph: Dict[str, Any], include_related: bool) -> Dict[str, Any]:
    edges = [e for e in graph["edges"] if include_related or e["type"] != "related"]
    nodes = []
    for n in graph["nodes"]:
        nodes.append(
            {
                "id": n["id"],
                "title": n.get("title"),
                "status": n.get("status"),
                "priority": n.get("priority"),
                "owner": n.get("owner"),
                "mode": n.get("mode"),
                "href": f"/.tickets/{n['id']}/ticket.md",
            }
        )
    return {"nodes": nodes, "edges": edges, "root_id": graph.get("root_id")}


def generate_example_tickets():
    util.ensure_dir(util.tickets_dir())
    now = util.now_utc()
    run_started = util.iso_basic(now)
    def new_id():
        return util.new_uuidv7().lower()

    # Pre-allocate ids so relationships can reference them
    ids = {
        "parent": new_id(),
        "backend": new_id(),
        "frontend": new_id(),
        "testing": new_id(),
        "docs": new_id(),
        "release": new_id(),
        "bugfix": new_id(),
    }

    specs = [
        {
            "key": "parent",
            "title": "Feature Alpha epic (parent ticket)",
            "status": "doing",
            "priority": "high",
            "labels": ["epic", "planning"],
            "assignment": {"mode": "mixed", "owner": "team:core"},
            "related": ["backend", "frontend", "testing", "docs", "release"],
            "agent_limits": {"iteration_timebox_minutes": 20, "max_iterations": 6, "max_tool_calls": 80, "checkpoint_every_minutes": 5},
            "verification": {"commands": ["python -m pytest", "./tkt_md/scripts/tickets validate"]},
            "body": {
                "description": "Track delivery of Feature Alpha and coordinate child tickets.",
                "acceptance": ["Children tickets created and linked", "Rollup status kept current", "Release plan agreed"],
                "verification": ["./tkt_md/scripts/tickets validate"],
            },
            "logs": [
                {
                    "summary": "Epic created and split into child tickets.",
                    "tickets_created": ["backend", "frontend", "testing", "docs"],
                    "next_steps": ["Coordinate release window", "Monitor blockers"],
                }
            ],
        },
        {
            "key": "backend",
            "title": "Feature Alpha API backend",
            "status": "doing",
            "priority": "high",
            "labels": ["backend", "api"],
            "assignment": {"mode": "agent_only", "owner": "agent:codex"},
            "dependencies": ["parent"],
            "blocks": ["frontend", "testing", "release"],
            "agent_limits": {"iteration_timebox_minutes": 15, "max_iterations": 4, "max_tool_calls": 60, "checkpoint_every_minutes": 5},
            "verification": {"commands": ["pytest tests/api"]},
            "body": {
                "description": "Implement service endpoints and data model for Feature Alpha.",
                "acceptance": ["Endpoints implemented", "Schema migrations applied", "Integration tests pass"],
                "verification": ["pytest tests/api", "curl http://localhost:8000/health"],
            },
            "logs": [
                {
                    "summary": "Scaffolded API and outlined endpoints.",
                    "decisions": ["Using UUID primary keys", "Respond with JSON:API style"],
                    "created_from": "parent",
                    "context_carried_over": ["Acceptance criteria from parent", "Release target"],
                }
            ],
        },
        {
            "key": "frontend",
            "title": "Feature Alpha frontend UI",
            "status": "todo",
            "priority": "medium",
            "labels": ["frontend", "ui"],
            "dependencies": ["backend"],
            "related": ["testing"],
            "verification": {"commands": ["npm test", "npm run lint"]},
            "body": {
                "description": "Build UI flows for Feature Alpha on the web client.",
                "acceptance": ["Screens implemented", "API integrated", "Accessibility checks pass"],
                "verification": ["npm test", "npm run lint", "npm run test:a11y"],
            },
            "logs": [
                {
                    "summary": "Waiting on API responses to stabilize.",
                    "blockers": ["Backend contract not finalized"],
                    "created_from": "parent",
                    "context_carried_over": ["Design mocks v1.2", "API schema draft"],
                }
            ],
        },
        {
            "key": "testing",
            "title": "Feature Alpha integration tests",
            "status": "todo",
            "priority": "medium",
            "labels": ["qa"],
            "dependencies": ["backend", "frontend"],
            "verification": {"commands": ["pytest tests/integration"]},
            "body": {
                "description": "Add end-to-end coverage for Alpha flows.",
                "acceptance": ["E2E happy path", "Error paths covered", "Regression suite green"],
                "verification": ["pytest tests/integration"],
            },
            "logs": [
                {
                    "summary": "Outlined E2E scenarios to automate.",
                    "next_steps": ["Set up test data fixtures"],
                    "created_from": "parent",
                    "context_carried_over": ["Frontend flow chart", "Backend contract v1"],
                }
            ],
        },
        {
            "key": "docs",
            "title": "Feature Alpha documentation",
            "status": "todo",
            "priority": "low",
            "labels": ["docs"],
            "dependencies": ["testing"],
            "verification": {"commands": ["npm run lint:docs"]},
            "body": {
                "description": "Document user guide and API reference for Alpha.",
                "acceptance": ["User guide drafted", "API examples updated", "Changelog entry added"],
                "verification": ["npm run lint:docs"],
            },
            "logs": [
                {
                    "summary": "Preparing outline; waiting on test results.",
                    "blockers": ["Integration tests pending"],
                    "created_from": "parent",
                    "context_carried_over": ["Feature overview", "Known limitations"],
                }
            ],
        },
        {
            "key": "release",
            "title": "Feature Alpha release coordination",
            "status": "todo",
            "priority": "high",
            "labels": ["release"],
            "dependencies": ["testing"],
            "blocks": ["bugfix"],
            "verification": {"commands": ["./tkt_md/scripts/tickets validate"]},
            "body": {
                "description": "Plan release window and rollout steps.",
                "acceptance": ["Release checklist approved", "Rollout scheduled", "Comms ready"],
                "verification": ["./tkt_md/scripts/tickets validate"],
            },
            "logs": [
                {
                    "summary": "Drafted release checklist; waiting on test green.",
                    "next_steps": ["Book release window"],
                }
            ],
        },
        {
            "key": "bugfix",
            "title": "Bugfix: address regression found during Alpha",
            "status": "blocked",
            "priority": "high",
            "labels": ["bug", "regression"],
            "dependencies": ["backend"],
            "related": ["testing"],
            "verification": {"commands": ["pytest tests/regression"]},
            "body": {
                "description": "Fix regression uncovered in integration tests.",
                "acceptance": ["Repro scenario fixed", "Regression test added", "No new failures"],
                "verification": ["pytest tests/regression"],
            },
            "logs": [
                {
                    "summary": "Blocked until backend fix lands.",
                    "blockers": ["Awaiting backend deployment"],
                }
            ],
        },
    ]

    for spec in specs:
        ticket_id = ids[spec["key"]]
        tdir = util.tickets_dir() / ticket_id
        util.ensure_dir(tdir / "logs")
        fm = {
            "id": ticket_id,
            "version": util.FORMAT_VERSION,
            "version_url": util.FORMAT_VERSION_URL,
            "title": spec["title"],
            "status": spec["status"],
            "created_at": util.iso8601(now),
        }
        if spec.get("priority"):
            fm["priority"] = spec["priority"]
        if spec.get("labels"):
            fm["labels"] = spec["labels"]
        if spec.get("assignment"):
            fm["assignment"] = spec["assignment"]
        for rel_key in ["dependencies", "blocks", "related"]:
            if spec.get(rel_key):
                fm[rel_key] = [ids[k] for k in spec[rel_key]]
        if spec.get("agent_limits"):
            fm["agent_limits"] = spec["agent_limits"]
        if spec.get("verification"):
            fm["verification"] = spec["verification"]

        body = [
            "# Ticket",
            "",
            "## Description",
            spec["body"]["description"],
            "",
            "## Acceptance Criteria",
            *[f"- [ ] {item}" for item in spec["body"]["acceptance"]],
            "",
            "## Verification",
            *[f"- {cmd}" for cmd in spec["body"]["verification"]],
            "",
        ]
        util.write_ticket(tdir / "ticket.md", fm, "\n".join(body))

        # Logs
        for entry in spec.get("logs", []):
            run_id = util.new_uuidv7()
            log_path = tdir / "logs" / f"{run_started}-{run_id}.jsonl"
            log_entry = {
                "version": util.FORMAT_VERSION,
                "version_url": util.FORMAT_VERSION_URL,
                "ts": util.iso8601(util.now_utc()),
                "run_started": run_started,
                "actor_type": "agent",
                "actor_id": "tickets-init",
                "summary": entry["summary"],
                "written_by": "tickets",
            }
            for k in ["decisions", "next_steps", "blockers", "tickets_created", "created_from", "context_carried_over"]:
                if k in entry:
                    val = entry[k]
                    if k == "tickets_created":
                        log_entry[k] = [ids[v] for v in val]
                    elif k == "created_from":
                        log_entry[k] = ids.get(val, val) if isinstance(val, str) else val
                    else:
                        log_entry[k] = val
            util.append_jsonl(log_path, log_entry)


def resolve_ticket_path(ticket_ref: str) -> Path:
    root = util.tickets_dir()
    p = Path(ticket_ref)
    if p.exists():
        if p.is_dir():
            return p / "ticket.md"
        return p
    candidate = root / ticket_ref / "ticket.md"
    if candidate.exists():
        return candidate
    raise SystemExit(f"Ticket not found: {ticket_ref}")


def cmd_status(args):
    tpath = resolve_ticket_path(args.ticket)
    fm, body = util.load_ticket(tpath)
    fm["status"] = args.status
    util.write_ticket(tpath, fm, body)
    if args.log:
        run_id = args.run_id or util.new_uuidv7()
        run_started = args.run_started or util.iso_basic(util.now_utc())
        log_entry = {
            "version": util.FORMAT_VERSION,
            "version_url": util.FORMAT_VERSION_URL,
            "ts": util.iso8601(util.now_utc()),
            "run_started": run_started.replace(" ", ""),
            "actor_type": "human",
            "actor_id": "status-change",
            "summary": f"Status set to {args.status}",
            "written_by": "tickets",
        }
        log_path = tpath.parent / "logs" / f"{run_started}-{run_id}.jsonl"
        util.append_jsonl(log_path, log_entry)
    return 0


def cmd_log(args):
    tpath = resolve_ticket_path(args.ticket)
    run_id = args.run_id or util.new_uuidv7()
    run_started = args.run_started or util.iso_basic(util.now_utc())
    entry: Dict[str, Any] = {
        "version": util.FORMAT_VERSION,
        "version_url": util.FORMAT_VERSION_URL,
        "ts": util.iso8601(util.now_utc()),
        "run_started": run_started.replace(" ", ""),
        "actor_type": args.actor_type,
        "actor_id": args.actor_id,
        "summary": args.summary,
    }
    if args.machine:
        entry["written_by"] = "tickets"
    if args.changes:
        entry["changes"] = {"files": args.changes}
    if args.decisions:
        entry["decisions"] = args.decisions
    if args.next_steps:
        entry["next_steps"] = args.next_steps
    if args.blockers:
        entry["blockers"] = args.blockers
    if args.tickets_created:
        entry["tickets_created"] = args.tickets_created
    if args.created_from:
        entry["created_from"] = args.created_from
    if args.context_carried_over:
        entry["context_carried_over"] = args.context_carried_over
    if args.verification_commands or args.verification_results:
        entry["verification"] = {"commands": args.verification_commands or [], "results": args.verification_results or ""}

    log_path = tpath.parent / "logs" / f"{run_started}-{run_id}.jsonl"
    util.append_jsonl(log_path, entry)
    return 0


def cmd_list(args):
    filters = {k: getattr(args, k) for k in ["status", "priority", "mode", "owner", "label", "text"]}
    rows = listing.list_tickets(filters)
    if args.json_out:
        json.dump(rows, sys.stdout, indent=2)
        return 0
    if not rows:
        print("No tickets.")
        return 0
    headers = ["id", "title", "status", "priority", "owner", "mode", "last_updated"]
    print(" | ".join(headers))
    for r in rows:
        print(" | ".join(str(r.get(h, "")) for h in headers))
    return 0


def cmd_repair(args):
    non_interactive = args.non_interactive
    if args.issues_file:
        issues_data = repair.load_issues_file(Path(args.issues_file))
        repairs = issues_data.get("repairs", [])
        if args.interactive:
            changes = repair.run_interactive(repairs, include_optional=args.all_fields)
        else:
            changes = repair.apply_repairs(repairs, non_interactive=non_interactive, include_optional=args.all_fields)
        for c in changes:
            print(c)
        return 0 if changes else 1
    targets = []
    if args.ticket:
        targets = [resolve_ticket_path(args.ticket)]
    elif args.all or not args.ticket:
        targets = validation.collect_ticket_paths(None)
    repairs = []
    for tpath in targets:
        issues, fm, body = validation.validate_ticket(tpath, all_fields=args.all_fields)
        repairs.extend(build_repairs_from_issues(issues, include_optional=args.all_fields, auto_enable_safe=not args.interactive))
    if args.interactive:
        changed = repair.run_interactive(repairs, include_optional=args.all_fields)
    else:
        changed = repair.apply_repairs(repairs, non_interactive=non_interactive, include_optional=args.all_fields)
    for c in changed:
        print(c)
    return 0 if changed else 1


def cmd_graph(args):
    tickets = load_ticket_graph(args.ticket)
    if not tickets["nodes"]:
        print("No tickets found.")
        return 1
    util.ensure_dir(util.repo_root() / ".tickets" / "graph")
    timestamp = util.iso_basic(util.now_utc())
    base = "dependencies"
    if args.ticket:
        base = f"dependencies_for_{tickets.get('root_id','subset')}"
    ext = {"mermaid": "md", "dot": "dot", "json": "json"}[args.format]
    default_path = util.repo_root() / ".tickets" / "graph" / f"{timestamp}_{base}.{ext}"
    out_path = Path(args.output) if args.output else default_path

    if args.format == "mermaid":
        content = render_mermaid(tickets, include_related=args.include_related, timestamp=timestamp)
    elif args.format == "dot":
        content = render_dot(tickets, include_related=args.include_related)
    else:
        content = render_json(tickets, include_related=args.include_related)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if args.format == "json":
        json.dump(content, out_path.open("w"), indent=2)
    else:
        out_path.write_text(content)
    print(out_path)
    return 0
