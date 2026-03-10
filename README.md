# tickets.md Monorepo

## About TICKETS.md

This repository uses a repo-native ticketing system designed for **parallel, long-running agentic work** and normal human collaboration, without relying on external services or internet access.

**TICKETS.md** explains the workflow, file formats, and required tool usage for both humans and agents. If there is ever a conflict between this file and other docs, follow this file.

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

## Spec Version

- `version`: 1
- `version_url`: `version/20260205-tickets-spec.md`
- Canonical source in this repo: `packages/tickets/.tickets/spec/version/20260205-tickets-spec.md`

Version definitions live under `packages/tickets/.tickets/spec/version/`. Each spec file is self-contained and ends with a diff from the previous version.

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

## Repository structure

```text
/apps/site                 # Next.js website
/packages/tickets       # npm package (@picoai/tickets)
/TICKETS.md                # canonical ticketing contract
```

## Workspaces

This repo uses npm workspaces.

- Site workspace: `@picoai/tickets-site` in `apps/site`
- Package workspace: `@picoai/tickets` in `packages/tickets`

## Common commands (from repo root)

```bash
npm install
npm run dev         # website dev server
npm run build       # website production build
npm run test        # package tests
npm run tickets -- --help
```

## Package usage

From any target repo:

```bash
npx @picoai/tickets init
npx @picoai/tickets init --apply
npx @picoai/tickets new --title "Short title"
npx @picoai/tickets validate
```

## Canonical docs

- Contract: `TICKETS.md`
- Agent bootstrap template source: `packages/tickets/.tickets/spec/AGENTS_EXAMPLE.md`
- Versioned format docs source: `packages/tickets/.tickets/spec/version/`
- Contribution guide: `CONTRIBUTING.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
