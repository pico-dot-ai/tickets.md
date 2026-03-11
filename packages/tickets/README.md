# @picoai/tickets

## About TICKETS.md

This repository specifies a repo-native ticketing workflow designed for **parallel, long-running agentic work** and normal human collaboration, without relying on external services or internet access.

**TICKETS.md** explains the workflow, file formats, and required tool usage for both humans and agents. If there is ever a conflict between this file and other docs, follow this file.

## What this system is

- A lightweight, Markdown-first ticket format stored under `/.tickets/` in consumer repos.
- A merge-friendly history model: **append-only JSONL run logs**, one file per run, per ticket.
- A repo-local CLI (`npx @picoai/tickets`) that is the **single integration surface** for humans, agents, and IDE/agentic tooling.

## What this is trying to do

Parallel, long-running agentic work fails in predictable ways:
- Agents lose context across runs/sandboxes.
- Ticket state can drift across branches before merge (eventual consistency).
- Shared mutable log files are merge-conflict hotspots.
- Agents can loop without clear done criteria or verification steps.

This system addresses those problems with stable `ticket.md` files, merge-friendly per-run logs, and explicit acceptance + verification + bounded iteration guidance.

## Spec Version

- `version`: 2
- `version_url`: `version/20260311-tickets-spec.md`
- Local file in package assets: `.tickets/spec/version/20260311-tickets-spec.md`

Version definitions live under `.tickets/spec/version/`. Each spec file is self-contained and ends with a diff from the previous version.

## Quickstart: Initialize a Repo

Assuming `@picoai/tickets` is already installed in your target repo:

```bash
npx @picoai/tickets init
```

This bootstraps ticketing assets in the target repository by creating:
- root `TICKETS.md`
- root `AGENTS_EXAMPLE.md`
- root `/.tickets/spec/version/` with version definition files

Optional apply mode:

```bash
npx @picoai/tickets init --apply
```

`--apply` updates managed sections while preserving user-owned content:
- updates the managed block in root `TICKETS.md`
- creates or updates the `## Ticketing Workflow` block in root `AGENTS.md`
- does not create `AGENTS_EXAMPLE.md` when applying directly to `AGENTS.md`

## Package Overview

Repo-native ticketing CLI for Markdown-first, append-only ticket workflows.

## Release Provenance

- Latest npm release: `@picoai/tickets`
- Latest published version: `0.2.0`
- Published from commit: `e1ed363`
- Append-only release ledger: `packages/tickets/release-history.json`

Check current release posture locally:

```bash
npm run release:status --workspace @picoai/tickets
```

Recommended process:
- after an npm publish succeeds, append a new entry to `packages/tickets/release-history.json`
- use `npm run release:status --workspace @picoai/tickets` to see whether HEAD is ahead of the last recorded npm release and whether the package version still needs a bump

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
npm install @picoai/tickets
npx @picoai/tickets init
npx @picoai/tickets init --apply
npx @picoai/tickets new --title "Short title"
npx @picoai/tickets validate
```

## Command Reference

Use `npx @picoai/tickets <command> --help` for full command help.

### `init`

Initialize ticketing structure and templates.

```bash
npx @picoai/tickets init [--examples] [--apply]
```

- `--examples`: generate example tickets and logs that validate under the current spec.
- `--apply`: update managed `TICKETS.md` + `AGENTS.md` sections and skip `AGENTS_EXAMPLE.md` output.

### `new`

Create a new ticket.

```bash
npx @picoai/tickets new --title "<title>" [options]
```

Options:
- `--status <status>` (`todo|doing|blocked|done|canceled`, default `todo`)
- `--priority <priority>` (`low|medium|high|critical`)
- `--label <label>` (repeatable)
- `--assignment-mode <mode>` (`human_only|agent_only|mixed`)
- `--assignment-owner <owner>`
- `--dependency <ticketId>` (repeatable)
- `--block <ticketId>` (repeatable)
- `--related <ticketId>` (repeatable)
- `--iteration-timebox-minutes <minutes>`
- `--max-iterations <count>`
- `--max-tool-calls <count>`
- `--checkpoint-every-minutes <minutes>`
- `--verification-command <command>` (repeatable)
- `--created-at <timestamp>`

### `validate`

Validate ticket files and logs.

```bash
npx @picoai/tickets validate [options]
```

Options:
- `--ticket <ticket>`
- `--issues` (machine-readable issues/repairs output)
- `--output <file>` (write issues report to file)
- `--all-fields` (include optional front-matter validation)

### `repair`

Repair tickets from current validation state or an issues file.

```bash
npx @picoai/tickets repair [options]
```

Options:
- `--ticket <ticket>`
- `--all`
- `--issues-file <file>`
- `--interactive`
- `--non-interactive`
- `--all-fields`

Notes:
- `repair` fixes ticket-file issues and basic log issues.
- Basic log repairs cover missing/invalid `event_type` and invalid or missing `context` on machine-written work logs.

### `status`

Update ticket status.

```bash
npx @picoai/tickets status --ticket <ticket> --status <status> [options]
```

Options:
- `--status <status>` (`todo|doing|blocked|done|canceled`)
- `--actor-type <human|agent>`
- `--actor-id <id>`
- `--context <items...>`
- `--run-id <runId>`
- `--run-started <runStarted>`

Notes:
- `status` always appends a machine-written status-change log entry.
- include `--context` when the status transition depends on new context you want preserved in the audit trail.
- `actor_id` default order: `--actor-id`, `TICKETS_ACTOR_ID`, `@${USER|USERNAME}`, `"unknown"`.
- `actor_type` default order: `--actor-type`, `TICKETS_ACTOR_TYPE`, inferred from `actor_id` prefix (`agent:` -> `agent`, `@` -> `human`), then `human`.

### `log`

Append a run log entry.

```bash
npx @picoai/tickets log --ticket <ticket> --summary "<text>" [options]
```

Options:
- `--actor-type <human|agent>`
- `--actor-id <id>`
- `--context <items...>`
- `--run-id <runId>`
- `--run-started <runStarted>`
- `--machine`
- `--changes <files...>`
- `--decisions <decisions...>`
- `--next-steps <nextSteps...>`
- `--blockers <blockers...>`
- `--tickets-created <tickets...>`
- `--created-from <ticketId>`
- `--verification-commands <commands...>`
- `--verification-results <results>`

Notes:
- `log` records run details without changing ticket lifecycle state.
- machine-written work logs require at least one `--context` item.
- for split child bootstrapping, use `--created-from <parent-ticket-id>` together with `--context ...`.
- `actor_id` default order: `--actor-id`, `TICKETS_ACTOR_ID`, `@${USER|USERNAME}`, `"unknown"`.
- `actor_type` default order: `--actor-type`, `TICKETS_ACTOR_TYPE`, inferred from `actor_id` prefix (`agent:` -> `agent`, `@` -> `human`), then `human`.

### `list`

List tickets with optional filters.

```bash
npx @picoai/tickets list [options]
```

Options:
- `--status <status>`
- `--priority <priority>`
- `--mode <mode>`
- `--owner <owner>`
- `--label <label>`
- `--text <text>`
- `--json`

Notes:
- `--text` searches the ticket title and Markdown body content.

### `graph`

Generate dependency graph output.

```bash
npx @picoai/tickets graph [options]
```

Options:
- `--ticket <ticket>`
- `--format <format>` (`mermaid|dot|json`, default `mermaid`)
- `--output <file>`
- `--related` / `--no-related`

## Assets shipped with this package

- `.tickets/spec/TICKETS.md` template source
- `.tickets/spec/AGENTS_EXAMPLE.md`
- `.tickets/spec/version/*`

These are used by `init` to bootstrap target repositories.
`init` writes `AGENTS_EXAMPLE.md` at the target repo root from the bundled template.
With `--apply`, `init` upserts/creates the managed `## Ticketing Workflow` block in `AGENTS.md` (header-targeted, marker-free) and does not create `AGENTS_EXAMPLE.md` in the target repo.
With `--apply`, `TICKETS.md` updates only the managed section (plus tool/spec/timestamp metadata) and preserves user-owned sections.
