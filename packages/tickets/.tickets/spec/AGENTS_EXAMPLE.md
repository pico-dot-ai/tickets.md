This file is an example for agent harnesses. Rename or copy it to `AGENTS.md` if your tooling reads it.

The purpose of this bootstrap is to ensure an agent loads the canonical ticketing workflow before doing any work.

## Ticketing Workflow

### Required Behavior
- First action: if your environment supports repo-local skills and `.tickets/skills/tickets/SKILL.md` exists, load that skill. Otherwise open and read `TICKETS.md`.
- First response: briefly confirm understanding of the ticketing system before starting any implementation work.
- Before interpreting planning language or creating tickets, consult `.tickets/config.yml` for repo-local defaults and semantic overrides.
- When the human uses feature/phase/milestone/roadmap or custom repo terms, keep using their vocabulary in the conversation and translate it into the generic CLI planning fields internally.
- Use the repo-local CLI (`npx @picoai/tickets`) as the integration surface for tickets and logs.
- Before performing work on a ticket, validate it: run `npx @picoai/tickets validate` (or `npx @picoai/tickets validate --issues` + `npx @picoai/tickets repair`).
- Before moving a ticket to `done`, confirm the ticket's `## Acceptance Criteria` are met and its `## Verification` checks passed.
- If those completion gates are not satisfied, ask the human whether to keep working or explicitly override the gates. Only move the ticket to `done` after that human decision.
- Record `completion` metadata every time a ticket is moved to `done`.
- When a human overrides incomplete completion gates, record that override in the ticket via `npx @picoai/tickets status --status done --acceptance-criteria ... --verification-state ... --override-by ... --override-reason ...`.
- When logging via the CLI: use `npx @picoai/tickets log --machine` so logs are strictly structured.
- Respect `assignment.mode`, `agent_limits`, active advisory claims, and repo-local defaults in `.tickets/config.yml`.

### Bootstrapping TICKETS.md
- If `.tickets/` or `TICKETS.md` are missing, run `npx @picoai/tickets init`.
- `init` also creates `.tickets/config.yml` and `.tickets/skills/tickets/SKILL.md`.
