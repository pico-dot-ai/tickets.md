# Contributing

Thanks for your interest in improving this project.

## Repo layout

- `apps/site`: Next.js website
- `packages/tickets`: npm package (`@picoai/tickets`)
- `TICKETS.md`: canonical ticketing contract

## Setup

```bash
npm install
```

## Common development commands

From the repo root:

```bash
npm run dev
npm run build
npm run test
npm run tickets -- --help
```

Workspace-specific equivalents:

```bash
npm run dev --workspace @picoai/tickets-site
npm run build --workspace @picoai/tickets-site
npm run test --workspace @picoai/tickets
```

## Ticket workflow

Use the published CLI surface:

```bash
npx @picoai/tickets init
npx @picoai/tickets new --title "Your short title"
npx @picoai/tickets validate
```

If working from an existing ticket, keep `ticket.md` stable and append run history to log files.

## Before opening a PR

- Run package tests: `npm run test`
- If website changes were made, run: `npm run build`
- Update docs when behavior changes

## Release tracking

- Published package provenance is tracked in `packages/tickets/release-history.json`
- Check current release posture with `npm run release:status`
- After an npm publish succeeds, append a new release entry with the published version and commit

## Contract changes

If you change ticket format or behavior, include:

- `TICKETS.md` updates
- version file updates under `/.tickets/spec/version/`
- CLI/validator changes in `packages/tickets`
- tests covering old/new behavior

## Code of Conduct

Please read `CODE_OF_CONDUCT.md` before contributing.
