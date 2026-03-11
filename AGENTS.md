This file instructs agent harnesses operating in this repository.

The purpose of this bootstrap is to ensure an agent loads the canonical workflow from `TICKETS.md` before doing any work.

## Ticketing Workflow

### Required Behavior
- First action: open and read `TICKETS.md` (canonical ticket workflow and rules).
- First response: briefly confirm understanding of the ticketing system described in `TICKETS.md` before starting any implementation work.
- Use the repo-local CLI (`npx @picoai/tickets`) as the integration surface for tickets and logs.
- Before performing work on a ticket, validate it: run `npx @picoai/tickets validate` (or `npx @picoai/tickets validate --issues` + `npx @picoai/tickets repair`).
- When logging via the CLI: use `npx @picoai/tickets log --machine` so logs are strictly structured.
- Respect `assignment.mode` and any `agent_limits` in the ticket/config.

### Bootstrapping TICKETS.md
- If `.tickets/` or `TICKETS.md` are missing, run `npx @picoai/tickets init`.

## Local Publishing Policy

This section is repo-local and should remain outside `## Ticketing Workflow` so `npx @picoai/tickets init --apply` does not overwrite it.

- Before publishing `@picoai/tickets`, run `npm run release:status` and read the result.
- If HEAD is ahead of the latest recorded npm release and the package version has not changed, bump the package version before publishing.
- Publish only from the `packages/tickets` workspace.
- Use an interactive terminal for publish/auth flows. Do not use token-based or non-interactive publish shortcuts when browser auth is expected.
- If npm authentication is required, use the browser-based flow: run `npm login --auth-type=web` interactively and complete authentication in the browser.
- Run `npm publish` interactively after authentication succeeds.
- Only after publish succeeds, append the new published version/commit/date entry to `packages/tickets/release-history.json`.
