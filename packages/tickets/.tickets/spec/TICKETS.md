# TICKETS.md - Agent-First In-Repo Ticketing

This document defines the agent-first in-repo ticketing workflow with explicit ownership boundaries.

## Ownership Boundaries

- About TICKETS.md (may be overwritten): content inside `@picoai/tickets:managed` markers.
  - This is where canonical, interoperable system rules live.
  - `npx @picoai/tickets init --apply` may replace this section.
- User-Owned Extensions (safe to customize): content inside `@picoai/tickets:user` markers.
  - This is where teams add repo-local policy, integrations, and reusable preferences.
  - Tooling should not overwrite this section.
- Repo-local machine overrides: `.tickets/config.yml`.
  - This is the authoritative override surface for semantic mapping, defaults, and reporting preferences.
  - Tooling should create it if missing, but should not overwrite it once present.
- Optional repo-local narrative overrides: `TICKETS.override.md`.
  - This is for rationale, examples, and human-readable local policy.
  - Tooling should not depend on it for machine behavior.

## Init and Apply Behavior

- `init`:
  - creates missing repo assets, including `TICKETS.md`, `.tickets/config.yml`, and `.tickets/skills/tickets/SKILL.md`.
- `init --apply`:
  - replaces the managed section in `TICKETS.md`,
  - updates the managed `## Ticketing Workflow` block in `AGENTS.md`,
  - refreshes the repo skill projection at `.tickets/skills/tickets/SKILL.md`,
  - preserves user-owned sections and repo-local override files.

---

<!-- @picoai/tickets:managed:start -->
## About TICKETS.md (May Be Overwritten by `init --apply`)

_This section mirrors the current canonical `TICKETS.md` content to preserve behavior and compatibility._

This repository uses a repo-native ticketing system designed for **parallel, long-running agentic work** and normal human collaboration, without relying on external services or internet access.

`TICKETS.md` explains the workflow, file formats, planning model, and required tool usage for both humans and agents. If there is ever a conflict between this file and other docs, follow this file.

## Spec version
- `version`: 3
- `version_url`: `version/20260317-tickets-spec.md`
- Local file: `/.tickets/spec/version/20260317-tickets-spec.md`

Version definitions live under `/.tickets/spec/version/`. Each spec file is self-contained and ends with a diff from the previous version.

## Canonical artifacts and precedence

The system supports both doc-first and skill-first environments without changing behavior.

Authoritative precedence:
1. CLI/spec invariants (non-overridable)
2. Package-managed base workflow and defaults
3. Repo-local `.tickets/config.yml`
4. Optional `TICKETS.override.md`

Repo artifacts:
- `TICKETS.md`: primary operational and conceptual contract
- `.tickets/config.yml`: authoritative repo-local machine-readable overrides
- `.tickets/skills/tickets/SKILL.md`: repo skill projection with equivalent workflow semantics
- `TICKETS.override.md`: optional narrative companion for human-only local policy

## What this system is
- A lightweight, Markdown-first ticket format stored under `/.tickets/`
- A merge-friendly history model: append-only JSONL run logs, one file per run, per ticket
- A repo-local CLI (`npx @picoai/tickets`) that is the only state-changing integration surface
- A generic planning model that supports features, phases, milestones, and roadmap views without hardcoding those terms into execution semantics

## Non-negotiables
- Keep `ticket.md` stable and human-readable. Put history in run logs.
- Keep run logs append-only. Never rewrite or delete log lines.
- Use the repo-local CLI for automation. Do not invent parallel formats.
- Do not derive execution behavior from free-form labels alone. Use the planning primitives.

## Quickstart

### Initialize
- `npx @picoai/tickets init`
- `npx @picoai/tickets init --apply`

Default `init` creates, if missing:
- `TICKETS.md`
- `AGENTS_EXAMPLE.md`
- `/.tickets/config.yml`
- `/.tickets/skills/tickets/SKILL.md`
- `/.tickets/spec/version/`

### Create and validate a ticket
- `npx @picoai/tickets new --title "Short title"`
- `npx @picoai/tickets validate`
- `npx @picoai/tickets validate --issues --all-fields --output issues.yaml`
- `npx @picoai/tickets repair --issues-file issues.yaml --all-fields --non-interactive`

### Coordinate work
- `npx @picoai/tickets status --ticket <id> --status doing`
- `npx @picoai/tickets log --ticket <id> --summary "..." --machine --context "..."`
- `npx @picoai/tickets claim --ticket <id>`
- `npx @picoai/tickets plan --format json`
- `npx @picoai/tickets graph --view portfolio`

## Repository layout
- Canonical workflow guide: `TICKETS.md`
- Machine-readable overrides: `/.tickets/config.yml`
- Repo skill projection: `/.tickets/skills/tickets/SKILL.md`
- Ticket storage root: `/.tickets/<ticket-id>/`
  - Ticket definition: `ticket.md`
  - Run logs: `logs/<run_started>-<run_id>.jsonl`

## Core planning model

The planning model is intentionally generic. Agents, validators, and rollups operate on these primitives, not on human aliases.

Primitives:
- `planning.node_type`: `work`, `group`, `checkpoint`
- `planning.group_ids`: membership edges pointing from a child to one or more containing groups
- `planning.precedes`: sequencing edges
- `planning.lane`: coarse ordering bucket
- `planning.rank`: fine ordering within a lane or peer set
- `planning.horizon`: roadmap scope such as `current`, `next`, `later`
- `status`: execution lifecycle state
- `resolution`: terminal work outcome: `completed`, `merged`, `dropped`
- advisory `claim`: optional coordination state, stored in logs only

Interpretation:
- `dependencies` and `blocks` are hard execution constraints
- `planning.precedes` is sequence/order, not a hard dependency
- `group_ids` is the only persisted grouping edge; reverse membership and rollups are derived
- `lane`, `rank`, and `horizon` are generic ordering dimensions, not hardcoded PM vocabulary
- claims do not change `status`

### Default human semantic mapping

By default:
- `feature` -> `planning.node_type = group`
- `phase` -> `planning.lane`
- `milestone` -> `planning.node_type = checkpoint`
- `roadmap` -> `planning.horizon`

Repos may override these mappings in `.tickets/config.yml` without changing the core CLI or validation invariants.

### Worked example

```yaml
---
id: 0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5c6d
version: 3
version_url: "version/20260317-tickets-spec.md"
title: "Feature Alpha"
status: doing
created_at: 2026-03-17T17:00:00Z
planning:
  node_type: group
  lane: build
  rank: 1
  horizon: current
---
```

Child work ticket:

```yaml
planning:
  node_type: work
  group_ids: ["0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5c6d"]
  lane: build
  rank: 2
  horizon: current
  precedes: ["0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5c6e"]
```

Checkpoint ticket:

```yaml
planning:
  node_type: checkpoint
  group_ids: ["0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5c6d"]
  lane: launch
  rank: 1
  horizon: current
```

Dropped child:

```yaml
status: canceled
resolution: dropped
```

Claim log example:

```json
{"version":3,"version_url":"version/20260317-tickets-spec.md","ts":"2026-03-17T17:05:00Z","run_started":"20260317T170500.000Z","actor_type":"agent","actor_id":"agent:codex","summary":"Acquired claim 0191c2d3-...","event_type":"claim","written_by":"tickets","claim":{"action":"acquire","claim_id":"0191c2d3-4e5f-7a8b-9c0d-1e2f3a4b5d00","holder_id":"agent:codex","holder_type":"agent","ttl_minutes":60,"expires_at":"2026-03-17T18:05:00Z","reason":""}}
```

## Ticket definition (`ticket.md`)

Ticket files are Markdown documents with YAML front matter and a Markdown body.

### Required front matter
- `id`: lowercase UUIDv7 string
- `version`: integer format version
- `version_url`: repo-local path to the spec
- `title`: string
- `status`: `todo|doing|blocked|done|canceled`
- `created_at`: ISO 8601 UTC timestamp

### Optional front matter

Assignment:
```yaml
assignment:
  mode: mixed
  owner: "agent:codex"
```

Priority and labels:
```yaml
priority: high
labels: ["feature", "api"]
```

Relationships:
```yaml
dependencies: []
blocks: []
related: []
```

Planning:
```yaml
planning:
  node_type: work
  group_ids: []
  lane: null
  rank: null
  horizon: null
  precedes: []
```

Resolution:
```yaml
resolution: completed   # completed | merged | dropped
```

Limits:
```yaml
agent_limits:
  iteration_timebox_minutes: 20
  max_iterations: 6
  max_tool_calls: 80
  checkpoint_every_minutes: 5
```

Verification:
```yaml
verification:
  commands:
    - "npm test"
    - "npx @picoai/tickets validate"
```

Custom fields:
```yaml
custom:
  my_org_priority: "P1"
```

Rules:
- `resolution` is only valid on terminal tickets (`done` or `canceled`)
- `custom` is reserved for repo-local extensions not standardized by the spec
- other relationship views are computed by tooling and must not be persisted in `ticket.md`

### Required body sections
- `# Ticket`
- `## Description`
- `## Acceptance Criteria`
- `## Verification`

## Status model
- `todo`, `doing`, `blocked`, `done`, `canceled`
- `done` and `canceled` are terminal unless explicitly reopened by a human

`tickets status` changes the canonical lifecycle state and appends a machine-written status entry to logs.

## Claims

Claims are optional advisory leases used to reduce duplicate swarm work.

Rules:
- claims live only in logs
- claims do not change ticket `status`
- a claim can be acquired, renewed, released, or force-overridden with a reason
- expired claims are treated as inactive

Use:
- `npx @picoai/tickets claim --ticket <id>`
- `npx @picoai/tickets claim --ticket <id> --release`
- `npx @picoai/tickets claim --ticket <id> --force --reason "..."` to override

## Run logs

Run logs are append-only JSONL files under `logs/`.

Required log fields:
- `version`
- `version_url`
- `ts`
- `run_started`
- `actor_type`
- `actor_id`
- `summary`
- `event_type`: `status|work|claim`

Conditional fields:
- `context`: required for machine-written `work` entries
- `claim`: required for `claim` entries

Recommended fields:
- `changes`
- `verification`
- `tickets_created`
- `created_from`
- `decisions`
- `next_steps`
- `blockers`
- `custom`

## Derived views and rollups

Rollups are always derived from ticket state and logs. Parent or group tickets do not maintain authoritative child ledgers.

Derived rollup counters:
- `total_leaf`
- `active_leaf`
- `todo`
- `doing`
- `blocked`
- `done_completed`
- `merged`
- `dropped`

Completion percentage uses only active leaf work. `merged` and `dropped` do not count against the remaining denominator.

## Commands

Primary commands:
- `init`
- `new`
- `validate`
- `repair`
- `status`
- `log`
- `claim`
- `list`
- `plan`
- `graph`

Listing and reporting:
- `list` can filter by planning fields, claim state, and readiness
- `plan` reports rollups and ready queues
- `graph` can render dependency, sequence, portfolio, or combined views

## Agent protocol

Agents should:
1. Load the repo skill if supported and present, otherwise read `TICKETS.md`
2. Open the assigned ticket
3. Validate before implementation
4. Respect `assignment.mode`, `agent_limits`, planning constraints, and active claims
5. Use `status`, `log`, `claim`, `plan`, and `graph` through the CLI
6. If splitting work, create child tickets with copied minimum context and log `created_from`

## Safety and hygiene
- Do not write secrets into tickets or logs
- Avoid unrelated refactors in ticket-scoped work
- Prefer adding logs with decisions and next steps over rewriting ticket history
<!-- @picoai/tickets:managed:end -->

---

<!-- @picoai/tickets:user:start -->
## User-Owned Extensions (Safe to Customize)

This section is intended for ongoing team customization and expansion.

### Working Agreements (Reusable Preferences)

Use this section for reusable team preferences agents should apply by default.

Examples:
- decomposition preference
- required human checkpoints
- verification evidence format
- claim usage policy
- rollout and handoff expectations

### External System Mapping

Document how external systems map to in-repo tickets.

### Local Semantic Notes

Use this section to explain local meanings for human-facing concepts such as feature, phase, milestone, and roadmap.
The machine-readable source of truth for overrides should remain `.tickets/config.yml`.
<!-- @picoai/tickets:user:end -->
