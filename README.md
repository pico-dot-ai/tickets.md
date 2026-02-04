# TICKETS.md

An Agent native, in-repo ticketing system designed for **parallel, long-running agentic development** (and normal human workflows) without relying on network access or external services.

This repo contains the system specification in `TICKETS.md` and includes an in-repo `tickets` CLI plus templates that implement that spec.

## What this is

- A lightweight, Markdown-based ticket format stored in-repo under `/.tickets/`.
- A merge-friendly logging model (append-only JSONL logs per run) that supports multiple agents working concurrently across branches.
- A small CLI surface (`tickets init/new/validate/log/status/list/repair`) intended to be the *single integration point* for agents, IDE integrations, and humans using agentic tools.

## Why this exists

Parallel, long-running agentic work tends to fail in predictable ways:

- **Context loss between runs**: agents need durable, repo-local “memory” so handoffs work across sandboxes and time.
- **Eventual-consistency across branches**: by the time work merges, ticket state may have changed; shared mutable logs/status files are conflict-prone.
- **Merge conflicts from concurrent appends**: multiple workers updating the same file (even at EOF) is a frequent source of conflicts.
- **Runaway iterations / unclear “done”**: agents need explicit acceptance criteria, verification steps, and hard iteration limits.
- **Auditability**: humans need to understand what happened and why without reconstructing context from chat transcripts.

This system addresses those issues by keeping ticket definitions stable and pushing history into **per-run, append-only JSONL logs** (one file per run), with strict structure for tooling-written entries and best-effort support for human notes.

## Goals

- **Offline-first**: everything needed to coordinate work lives in the repo (no required internet access).
- **Merge-friendly parallelism**: concurrent runs write to different log files to minimize conflicts.
- **Agent-safe execution**: iteration limits + required stop-and-handoff logs to prevent runaway behavior.
- **Human-friendly tickets**: ticket definitions remain readable and lightweight; logs capture history without churning `ticket.md`.
- **Consistent integrations**: external tools should interact via the repo-local `tickets` CLI (not bespoke formats).
- **Optional GitHub compatibility**: tickets can map cleanly to Issues for title/state/labels, without requiring Issues as the system of record.

## Non-goals

- A full project management suite.
- A required replacement for GitHub Issues.
- A hosted service or web UI (v1).
- Background daemons for core functionality.
- A prescribed orchestration/harness model for how agents are routed/claimed/arbitrated.

## Where to start

- Read the spec: `TICKETS.md`
- See CLI help: `./scripts/tickets --help`

## Usage and tooling

For full workflow, CLI commands, and ticket format, see `TICKETS.md` (canonical). README is project overview and FAQ only.

## Quickstart

If you're using this repo directly:

```
./scripts/tickets init
./scripts/tickets new --title "Short title"
```

If you're using this in another repo, copy the CLI and package first:

```
cp -R scripts tickets /path/to/your/repo/
```

Then install dependencies (below), and initialize:

```
./scripts/tickets init
```

Add `--examples` to generate 7 sample tickets + logs.

What `init` generates:

```
/.tickets/
TICKETS.md
AGENTS_EXAMPLE.md
```

If your tooling expects `AGENTS.md`, copy or rename `AGENTS_EXAMPLE.md`.

## Dependencies

The CLI and templates are Python-based and require a couple of lightweight libraries:

- `PyYAML` (>= 6.0): YAML parsing/serialization for ticket front matter, issue reports, and repairs.
- `uuid6` (>= 2024.1.25): Generates UUIDv7 IDs for tickets and run logs, matching the spec’s required ID format.

Install them directly:

```
python3 -m pip install "PyYAML>=6.0" "uuid6>=2024.1.25"
```

Ensure these versions or newer are on the Python path before running `scripts/tickets`.
