# Ticketing Workflow

This file is an example for agent harnesses. Rename or copy it to `AGENTS.md` if your tooling reads it.

The purpose of this bootstrap is to ensure an agent loads the canonical workflow from `TICKETS.md` before doing any work.

## Required behavior
- First action: open and read `TICKETS.md` (canonical ticket workflow and rules).
- First response: briefly confirm understanding of the ticketing system described in `TICKETS.md` before starting any implementation work.
- Use the repo-local CLI (`npx @picoai/tickets`) as the integration surface for tickets and logs.
- Before performing work on a ticket, validate it: run `npx @picoai/tickets validate` (or `npx @picoai/tickets validate --issues` + `npx @picoai/tickets repair`).
- When logging via the CLI: use `npx @picoai/tickets log --machine` so logs are strictly structured.
- Respect `assignment.mode` and any `agent_limits` in the ticket/config.

## Bootstrapping TICKETS.md
- If `.tickets/` or `TICKETS.md` are missing, run `npx @picoai/tickets init`.
