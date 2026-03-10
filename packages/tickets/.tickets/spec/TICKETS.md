# TICKETS.md - Agent-First In-Repo Ticketing

This document defines the agent-first in-repo ticketing workflow with explicit ownership boundaries.

## Ownership Boundaries

- About TICKETS.md (may be overwritten): content inside `@picoai/tickets:managed` markers.
  - This is where canonical, interoperable system rules live.
  - `npx @picoai/tickets init --apply` may replace this section (marker-scoped update).
- User-Owned Extensions (safe to customize): content inside `@picoai/tickets:user` markers.
  - This is where teams add local policy, integrations, and reusable preferences.
  - Tooling should not overwrite this section.

## Init and Apply Behavior

- `init`:
  - creates missing repo assets (including root `TICKETS.md`).
- `init --apply`:
  - replaces the managed section only (no heading-level merge across the full document),
  - preserves user-owned content.

---

<!-- @picoai/tickets:managed:start -->
## About TICKETS.md (May Be Overwritten by `init --apply`)

_This section mirrors current canonical `TICKETS.md` content to preserve behavior and compatibility._

This repository uses a repo-native ticketing system designed for **parallel, long-running agentic work** and normal human collaboration, without relying on external services or internet access.

**TICKETS.md ** explains the workflow, file formats, and required tool usage for both humans and agents. If there is ever a conflict between this file and other docs, follow this file.

## Spec version
- `version`: 1
- `version_url`: `version/20260205-tickets-spec.md`
- Local file: `/.tickets/spec/version/20260205-tickets-spec.md`

Version definitions live under `/.tickets/spec/version/`. Each spec file is self-contained and ends with a diff from the previous version.

## What this system is
- A lightweight, Markdown-first ticket format stored under `/.tickets/`.
- A merge-friendly history model: **append-only JSONL run logs**, one file per run, per ticket.
- A repo-local CLI (`npx @picoai/tickets`) that is the **single integration surface** for humans, agents, and IDE/agentic tooling.

## What this is trying to do
Parallel, long-running agentic work fails in predictable ways:
- Agents lose context across runs/sandboxes.
- Ticket “state” can drift across branches before merge (eventual consistency).
- Shared mutable log files are merge-conflict hotspots.
- Agents can loop without clear “done” criteria or verification steps.

This system addresses those problems with stable `ticket.md` files, merge-friendly per-run logs, and explicit acceptance + verification + bounded iteration guidance.

## Non-negotiables (for merge safety and auditability)
- **Keep `ticket.md` stable and human-readable.** Put history in run logs.
- **Append-only logs.** Never rewrite or delete log lines.
- **Use the repo-local CLI for automation.** Don’t invent parallel formats.

---

## Quickstart (humans and agents)

### Initialize
Create the repo structure and templates (idempotent):
- `npx @picoai/tickets init`
- Add `--examples` to generate example tickets (7 sample tickets with required/optional fields, relationships, and logs).
- Add `--apply` to upsert/create the managed `## Ticketing Workflow` block in `AGENTS.md` from `AGENTS_EXAMPLE.md` (without creating `AGENTS_EXAMPLE.md` in the target repo).
- With `--apply`, `TICKETS.md` updates are marker-scoped: the managed block is replaced and metadata refreshed, while user-owned sections remain unchanged.

Default `init` creates (if missing): `/.tickets/`, `TICKETS.md`, `AGENTS_EXAMPLE.md`, and `/.tickets/spec/version/`.

### Create a ticket
- `npx @picoai/tickets new --title "Short title"` (defaults: `status: todo`, `created_at: now`)
- Optional flags to set front matter at creation:
  - `--status todo|doing|blocked|done|canceled`
  - `--priority low|medium|high|critical`
  - `--label <label>` (repeatable)
  - `--assignment-mode human_only|agent_only|mixed`
  - `--assignment-owner <@user|team:...|agent:...>`
  - `--dependency <ticket-id>` `--block <ticket-id>` `--related <ticket-id>` (repeatable)
  - `--iteration-timebox-minutes <int>` `--max-iterations <int>` `--max-tool-calls <int>` `--checkpoint-every-minutes <int>`
  - `--verification-command "<cmd>"` (repeatable)
  - `--created-at <ISO8601 UTC>`

This prints the new ticket ID (a lowercase UUIDv7) and creates:
- `/.tickets/<ticket-id>/ticket.md`
- `/.tickets/<ticket-id>/logs/`

### Validate, then work
- `npx @picoai/tickets validate`
- Add `--all-fields` to also validate optional front-matter (priority, labels, assignment.owner, verification.commands) and include those in `--issues` reports.

If validation fails and you want a complete report + repair plan:
- `npx @picoai/tickets validate --issues --all-fields > issues.yaml`
- `npx @picoai/tickets repair --issues-file issues.yaml --all-fields --non-interactive`

### Log your work (human or agent)
Use the CLI to write logs whenever possible (merge-friendly, structured, and tooling-validated).

Agentic tools (including human-invoked tools like Cursor/Windsurf/Codex CLI/Claude Code) SHOULD log with `--machine`:
- `npx @picoai/tickets log --ticket <id> --actor-type agent --actor-id "cursor (human:@alice)" --summary "Implemented validator." --machine`

Humans can log without machine marker:
- `npx @picoai/tickets log --ticket <id> --actor-type human --actor-id "@alice" --summary "Investigated failing test; will retry tomorrow."`

---

## Repository layout
- Canonical workflow guide: `TICKETS.md`
- Ticket storage root: `/.tickets/`
- One ticket per directory: `/.tickets/<ticket-id>/`
  - Ticket definition: `/.tickets/<ticket-id>/ticket.md`
  - Run logs: `/.tickets/<ticket-id>/logs/<run_started>-<run_id>.jsonl`

Notes:
- `<ticket-id>` is a **lowercase UUIDv7** string.
- Tooling MUST NOT require the directory name to match the `id` in front matter (convention only).

---

## Ticket definition (`ticket.md`)
Ticket files are Markdown documents with YAML front matter and a Markdown body.

### YAML front matter
Front matter MUST start at the first line and be enclosed by `---`.

#### Required fields
- `id`: lowercase UUIDv7 string
- `version`: format version (integer)
- `version_url`: path to the definition for this version (repo-local, relative to `.tickets/spec/`)
- `title`: string
- `status`: `todo|doing|blocked|done|canceled`
- `created_at`: ISO 8601 timestamp in UTC (use `Z`)

Example:

```md
---
id: 0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5c6d
version: 1
version_url: "version/20260205-tickets-spec.md"
title: "Add tickets validate --issues"
status: todo
created_at: 2026-01-29T18:42:10Z
---
# Ticket
...
```

#### Optional fields
**Assignment and mode**
```yaml
assignment:
  mode: mixed   # human_only | agent_only | mixed
  owner: null   # "@alice", "team:core", "agent:codex"
```

**Priority and labels**
```yaml
priority: medium      # low | medium | high | critical
labels: ["bug", "docs"]
```

**Relationships (the only ones written in v1)**
```yaml
dependencies: []   # ticket IDs this ticket depends on
blocks: []         # ticket IDs this ticket blocks
related: []        # ticket IDs related to this ticket
```

**Agent limits (hard limits for agents)**
```yaml
agent_limits:
  iteration_timebox_minutes: 20
  max_iterations: 6
  max_tool_calls: 80
  checkpoint_every_minutes: 5
```

**Verification commands**
```yaml
verification:
  commands:
    - "npm test"
    - "npx @picoai/tickets validate"
```

Important:
- Other relationship views (parent/child rollups, duplicates, supersedes, reverse edges, etc.) are computed by tooling and MUST NOT be persisted in `ticket.md`.
- There is no `updated_at`. “Last updated” is derived from log timestamps (`ts`).

**Custom fields (namespaced)**
```yaml
custom:
  my_org_priority: "P1"
  upstream_ref: "RFC-42"
```

Custom fields MUST live under `custom` to avoid collisions. Tooling should ignore unknown keys under `custom`.
Extensions are repo-local; use a clear prefix for keys and avoid introducing new top-level extension fields.

### Versioning
- `version` is an integer format version (current: `1`).
- `version_url` must point to the repo-local definition for that version.
- Version files live under `/.tickets/spec/version/` and end with a diff from the previous version.
- New tooling must read older versions. If `version` is missing, tools may assume `1` and warn.
- Bumps are rare and only when a change cannot be expressed additively.

### Ticket body sections (required)
The ticket body MUST include these sections (at least the headings):
- `# Ticket`
- `## Description`
- `## Acceptance Criteria` (checkable list)
- `## Verification` (commands or steps)

---

## Status model
Status values: `todo`, `doing`, `blocked`, `done`, `canceled`.

Recommended transitions:
- `todo` -> `doing` | `canceled`
- `doing` -> `blocked` | `done` | `canceled`
- `blocked` -> `doing` | `canceled`
- `done` and `canceled` are immutable unless explicitly reopened by a human (set to `doing` and log why).

Status updates:
- `npx @picoai/tickets status --ticket <id> --status doing --log`

---

## Run logs (append-only JSONL)
Every ticket directory has `logs/`. Logs are where history lives; they are designed to be merge-friendly under parallel work.

### File naming: `<run_started>-<run_id>.jsonl`
- `run_started` is the run start time (UTC). It is a *hint* for processing order (tools may process newer runs first by sorting filenames).
- Tools SHOULD emit `run_started` in ISO 8601 **basic** form for filenames, e.g. `20260129T184210.123Z`.
- `run_id` is an identifier for the run (tool-generated unless provided).

Example filename:
- `/.tickets/<id>/logs/20260129T184210.123Z-0191c2d3-....jsonl`

### `ts` vs `run_started`
- `run_started` is constant for a given run file (and appears on every line so each JSON object is self-contained).
- `ts` is per entry (the moment that particular log entry was written).
- “Last updated” is derived from the newest `ts` across all logs, not from filenames.

### Log entry schema (one JSON object per line)
Required fields:
- `version`: format version (integer)
- `version_url`: path to the definition for this version (repo-local, relative to `.tickets/spec/`)
- `ts`: ISO 8601 UTC timestamp for the entry
- `run_started`: ISO 8601 UTC timestamp (same for all entries in the file)
- `actor_type`: `human|agent`
- `actor_id`: string identifier (freeform)
- `summary`: short summary string
- `context`: `[...]` (bullets capturing the context relevant to this run; when splitting, include copied/adapted inputs from the parent)

Optional structured fields (recommended):
- `changes`: `{files: [...], commits: [...], prs: [...]}`
- `verification`: `{commands: [...], results: "pass|fail|explain why not run"}`
- `tickets_created`: `[...]` (ticket IDs created during this run)
- `created_from`: string (parent ticket ID when created by splitting)
- `decisions`, `next_steps`, `blockers`: lists of strings
- `custom`: `{...}` (namespaced custom data)

Machine marker:
- If a log entry is written by the `tickets` CLI with `--machine`, it MUST include a machine marker:
  - `written_by: "tickets"` or `machine: true`

Validation strictness:
- Machine-marked entries are validated strictly.
- Non-machine entries are validated best-effort (warnings by default), so humans can jot notes without breaking the system.

Example machine-written entry:
```json
{"version":1,"version_url":"version/20260205-tickets-spec.md","ts":"2026-01-29T18:50:00Z","run_started":"20260129T184210.123Z","actor_type":"agent","actor_id":"codex-cli (human:@alice)","summary":"Implemented tickets validate --issues.","context":["Inputs: AC from ticket, API schema v2"],"verification":{"commands":["npx @picoai/tickets validate"],"results":"pass"},"written_by":"tickets"}
```

Merge conflict rule (rare):
- If a `.jsonl` file conflicts, keep all lines from both sides; do not “clean up” history.

---

## Required tool usage (agents and automation)
To keep state consistent and merge-friendly, agents and agentic tools SHOULD use the CLI for ticket operations:
- Create tickets: `npx @picoai/tickets new`
- Validate: `npx @picoai/tickets validate` (or `--issues` for a full report)
- Repair: `npx @picoai/tickets repair --issues-file ...`
- Status changes: `npx @picoai/tickets status --log`
- Work logs: `npx @picoai/tickets log` (use `--machine` when the entry is tooling-written)
- Listing/triage: `npx @picoai/tickets list` (use `--json` for automation)

Humans may edit `ticket.md` directly (it is designed for that), but logs should be appended via the CLI whenever feasible.

---

## Agent task assignment at launch time

### Principle
Agents SHOULD NOT choose tickets autonomously by default. In this system, a human or orchestrator assigns a specific ticket (or a small set of tickets) to each agent run. This avoids duplicate work when multiple agents operate from the same repo snapshot and cannot coordinate live.

### Required inputs for any agent run
Every agent run MUST be given, in its initial instructions (prompt, task description, CLI args, PR comment, IDE task, etc.):

1. Ticket locator
   - A ticket ID, which maps to the ticket definition at:
     - `/.tickets/<ticket-id>/ticket.md`

2. Task scope
   - A short statement of what the agent is expected to do on that ticket (for example: "implement acceptance criteria", "fix failing tests", "investigate and report").

3. Run limits
   - The run's execution limits (timebox / max tool calls / max iterations), if the ticket defines them. Agents must treat these as hard stop conditions.

### Standard instruction template
When launching an agent, use the following template (adapt as needed to the agent tool, but keep the semantics):

- Ticket: `<ticket-id>`
- Ticket file: `/.tickets/<ticket-id>/ticket.md`
- Scope: `<what to do>`
- Limits: follow `agent_limits` in the ticket (or repo defaults if not present)
- Stop behavior: on limit hit, stop work and write a run log entry to:
  - `/.tickets/<ticket-id>/logs/<run_started>-<run_id>.jsonl`

### Mandatory agent procedure (vendor-agnostic)
Given a ticket assignment, an agent must:

1. Open the ticket file at `/.tickets/<ticket-id>/ticket.md`.
2. Identify acceptance criteria and verification steps from the ticket.
3. Plan minimally: determine the smallest change set that satisfies the acceptance criteria.
4. Implement within limits.
5. Verify using the ticket's verification steps (or reasonable defaults if absent).
6. Log the run:
   - Write progress and outcomes to a per-run log file:
     - `/.tickets/<ticket-id>/logs/<run_started>-<run_id>.jsonl`
     - Include a `context` field capturing the relevant context for this run (copied/adapted inputs, decisions carried in, and any subticket handoff details).
   - If the agent cannot write files, it must output the log content in its final response so a human/tool can persist it.

### What to do if the ticket is missing or invalid
If the assigned ticket file cannot be found, or is missing required sections:
- The agent must not proceed with implementation.
- The agent must log the issue and request clarification, or propose a minimal ticket fix as its output.

### Multi-ticket assignments (rare)
If an agent is assigned more than one ticket in a single run:
- The run instructions must list ticket IDs in priority order.
- The agent must work on only one ticket at a time, logging separately under each ticket’s logs directory.
- Prefer splitting work into separate runs for clarity.

### Human responsibility
Humans (or an orchestrator) are responsible for:
- selecting which tickets are assigned to which agents
- ensuring two agents are not intentionally assigned the same ticket unless parallel exploration is desired

---

## Agent workflow (recommended protocol)
Agents MUST:
- Read the ticket before starting work.
- Respect `assignment.mode` (do not work tickets marked `human_only`).
- Respect hard limits in `agent_limits`; if a limit is reached, stop and write a log entry.
- At the end of an iteration (success or failure), write a log entry that includes the `context` for that iteration and verification results (or why verification was not run).
- If `max_iterations` is reached without completion, stop and log a recommendation (tighten criteria, split subtickets, or request a human decision).

Humans using agentic coding tools can follow the same protocol; use `--machine` logging with `actor_type: agent` and an `actor_id` that names the tool and the human (e.g., `cursor (human:@alice)`).

---

## Splitting tickets (subtickets) in parallel workflows
If an agent discovers a ticket is too large or should be parallelized:
1) Create subtickets with `npx @picoai/tickets new`.
2) Link with `related` (and only use `dependencies`/`blocks` when there is a real ordering constraint).
3) Log the split on the original ticket and include `tickets_created`.
4) Ensure each new ticket is executable in isolation by copying/adapting the minimum required context into the child `ticket.md`, and writing a first child log entry that includes `created_from` and `context` (the carried-over bullets).

Avoid maintaining an authoritative “subtickets list” by frequently editing the parent `ticket.md` (it’s a merge-conflict hotspot). Prefer derived views and logs.

---

## Validation, issues reports, and repair
- `npx @picoai/tickets validate`:
  - exit `0`: ok
  - exit `1`: validation errors
  - exit `2`: tooling/IO errors
- Add `--all-fields` to validate optional front-matter (priority, labels, assignment.owner, verification.commands) and include corresponding repairs in `--issues` output.

- `npx @picoai/tickets validate --issues` emits a machine-readable report with:
  - all `issues` (errors and warnings), and
  - a `repairs` section that can be edited and consumed by `tickets repair` in `--non-interactive` mode.
- Use `--all-fields` with `validate` and `repair` when you want optional front-matter fields to be checked and fixed.
- Use `--interactive` with `repair` to step through each fix, see what’s expected, and supply values (include `--all-fields` to cover optional fields too).

Minimal shape (example):
```yaml
schema_version: 1
tool: "tickets"
generated_at: "2026-01-29T00:00:00Z"
issues: []
repairs:
  - id: "R0001"
    enabled: false
    safe: true
    action: "add_sections"
    ticket_path: "/.tickets/<id>/ticket.md"
    params: {}
```

- `npx @picoai/tickets repair --issues-file <path>` applies enabled repairs:
  - Safe repairs can be non-interactive.
  - Disruptive repairs (like changing `id`) must have explicit decisions filled in (or require interactive mode).

---

## Safety & hygiene
- Do not write secrets into tickets or logs.
- Avoid pasting large environment dumps into logs.
- Prefer minimal diffs; avoid unrelated refactors.
- When in doubt, add a log entry with decisions and next steps, and hand off.
<!-- @picoai/tickets:managed:end -->

---

<!-- @picoai/tickets:user:start -->
## User-Owned Extensions (Safe to Customize)

This section is intended for ongoing team customization and expansion.

### Working Agreements (Reusable Preferences)

Use this section for reusable team preferences agents should apply by default.

Examples:
- decomposition preference (smaller tickets vs milestone-oriented tickets)
- required human checkpoints for risky changes
- default verification evidence format
- branch/PR naming conventions
- handoff expectations for agent-to-human and agent-to-agent transitions

### External System Mapping (Product/Design/Engineering + Agent Teams)

Document how external systems map to in-repo tickets.

Recommended fields to document:
- source systems (Jira/Linear/Notion/Figma/etc.)
- external state -> canonical `status` mapping
- assignment and ownership boundaries (human teams vs agent teams/swarms)
- synchronization rules and conflict resolution approach

### Local Custom Policy

Use this area for repo-specific policy that should not be overwritten.

Examples:
- additional review gates before moving ticket status to `done`
- rules for high-risk or production-impacting changes
- release-note and changelog policy

### Optional Team Metadata Conventions

If teams need additional metadata, prefer `custom.*` namespaced keys in ticket front matter and logs.

Examples:
- `custom.external.ticket_id`
- `custom.external.state`
- `custom.routing.queue`
- `custom.design.figma_url`

<!-- @picoai/tickets:user:end -->
