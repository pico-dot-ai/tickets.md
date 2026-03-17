# @picoai/tickets

`@picoai/tickets` is a repo-native ticketing CLI.

It gives a repository:
- a documented workflow in `TICKETS.md`
- a machine-readable override layer in `.tickets/config.yml`
- append-only ticket logs for history
- planning views built from simple shared primitives
- optional claims to reduce duplicate work across agents

The system is designed for teams that want ticket state to live in the repo, stay inspectable, and work the same way for humans and agents.

## Mental model

- `TICKETS.md` explains the workflow at the repo level
- `.tickets/config.yml` holds repo-local defaults and semantic overrides
- `.tickets/skills/tickets/SKILL.md` carries the same workflow for skill-capable environments
- `ticket.md` holds the stable definition of a piece of work
- JSONL logs hold append-only history
- planning is expressed with a small generic model instead of hardcoded product vocabulary
- claims are optional and advisory, not locks

## Spec version

- `version`: 3
- `version_url`: `version/20260317-tickets-spec.md`
- Local file in package assets: `.tickets/spec/version/20260317-tickets-spec.md`

## Install

```bash
npm install @picoai/tickets
```

Or run directly:

```bash
npx @picoai/tickets --help
```

## Quickstart

```bash
npx @picoai/tickets init
npx @picoai/tickets new --title "Feature Alpha" --node-type group --lane build --horizon current
npx @picoai/tickets validate
npx @picoai/tickets plan --format json
```

`init` creates, if missing:
- `TICKETS.md`
- an `AGENTS.md` workflow block when used with `--apply`
- `.tickets/config.yml`
- `.tickets/skills/tickets/SKILL.md`
- `.tickets/spec/version/`

## Planning model

The planning model is intentionally small. The CLI works from these fields:

```yaml
planning:
  node_type: work | group | checkpoint
  group_ids: []
  lane: null
  rank: null
  horizon: null
  precedes: []
resolution: null # completed | merged | dropped
```

How to think about them:
- `node_type`: what kind of thing this ticket is
- `group_ids`: which larger buckets this ticket belongs to
- `lane`: a broad ordered track such as a phase or stream
- `rank`: order within a lane or peer set
- `horizon`: a planning bucket such as current, next, or later
- `precedes`: sequence edges without turning everything into a hard dependency
- `resolution`: terminal outcome when work was completed, merged away, or dropped

Default semantic mapping:
- `feature` -> `planning.node_type=group`
- `phase` -> `planning.lane`
- `milestone` -> `planning.node_type=checkpoint`
- `roadmap` -> `planning.horizon`

Repos can override those terms in `.tickets/config.yml` without changing core execution semantics.

## Claims

Claims are optional advisory leases recorded in ticket logs.

```bash
npx @picoai/tickets claim --ticket <id>
npx @picoai/tickets claim --ticket <id> --release
npx @picoai/tickets claim --ticket <id> --force --reason "Taking ownership after timeout"
```

Claims do not change ticket `status`.
They exist to help multiple agents avoid overlapping work, not to act as hard locks.

## Commands

### `init`

```bash
npx @picoai/tickets init [--examples] [--apply]
```

- `--examples`: generate example tickets and logs that validate under the current spec
- `--apply`: refresh managed `TICKETS.md`, the managed `AGENTS.md` workflow block, and repo skill content

### `new`

```bash
npx @picoai/tickets new --title "<title>" [options]
```

Planning options:
- `--node-type <work|group|checkpoint>`
- `--group-id <ticketId>` repeatable
- `--lane <lane>`
- `--rank <rank>`
- `--horizon <horizon>`
- `--precedes <ticketId>` repeatable
- `--resolution <completed|merged|dropped>`

### `validate`

```bash
npx @picoai/tickets validate [--ticket <ticket>] [--issues] [--output <file>] [--all-fields]
```

Validates:
- ticket front matter and required sections
- machine-written log entries
- claim event payloads
- repo-local `.tickets/config.yml`

### `status`

```bash
npx @picoai/tickets status --ticket <ticket> --status <status> [options]
```

Always appends a machine-written status log entry.

### `log`

```bash
npx @picoai/tickets log --ticket <ticket> --summary "<text>" [options]
```

Machine-written work logs require at least one `--context` item.

### `claim`

```bash
npx @picoai/tickets claim --ticket <ticket> [--ttl-minutes <minutes>] [--force] [--reason <reason>]
```

### `list`

```bash
npx @picoai/tickets list [options]
```

Additional filters:
- `--node-type <nodeType>`
- `--group <ticketId>`
- `--lane <lane>`
- `--horizon <horizon>`
- `--claimed`
- `--claimed-by <actorId>`
- `--ready`
- `--json`

### `plan`

```bash
npx @picoai/tickets plan [--group <ticket>] [--horizon <horizon>] [--format table|json]
```

Reports ready work and derived group/checkpoint rollups.

Use this when you want to answer:
- what is ready now
- what is blocked
- how a group or checkpoint is progressing

### `graph`

```bash
npx @picoai/tickets graph [--ticket <ticket>] [--view dependency|sequence|portfolio|all] [--format mermaid|dot|json]
```

## Assets shipped with this package

- `.tickets/spec/TICKETS.md`
- `.tickets/spec/AGENTS_EXAMPLE.md`
- `.tickets/spec/profile/defaults.yml`
- `.tickets/spec/version/`
