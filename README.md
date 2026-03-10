# tickets.md Monorepo

This repository contains:

- The canonical ticketing contract in `TICKETS.md`
- The publishable npm CLI package `@picoai/tickets`
- The project website

## Repository structure

```text
/apps/site                 # Next.js website
/packages/tickets       # npm package (@picoai/tickets)
/docs                      # repo docs and drafts
/.tickets                  # local repo tickets
/.tickets/spec             # canonical templates/spec assets used by init
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
- Agent bootstrap example: `AGENTS_EXAMPLE.md`
- Versioned format docs: `/.tickets/spec/version/`
- Contribution guide: `CONTRIBUTING.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
