# @picoai/tickets

This repository contains the source code for the `@picoai/tickets` npm package.

If you are working here, you are changing the package itself:
- the CLI in `packages/tickets/src`
- the tests in `packages/tickets/tests`
- the docs site in `apps/site`
- the templates and specs the package installs into other repos

## Where Things Live

- `packages/tickets/src`: CLI implementation
- `packages/tickets/tests`: package tests
- `packages/tickets/.tickets/spec`: templates, defaults, and versioned specs shipped by the package
- `packages/tickets/README.md`: package-level documentation
- `apps/site`: documentation site

## What The Package Installs Elsewhere

When someone runs `@picoai/tickets` in another repo, the package can create and maintain files like:
- `TICKETS.md`
- an `AGENTS.md` workflow block via `init --apply`
- `/.tickets/config.yml`
- `/.tickets/skills/tickets/SKILL.md`
- `/.tickets/spec/version/*`

Those files are package assets. They help explain how the package works, but they are not the working layout of this repository.

The canonical copies live under `packages/tickets/.tickets/spec/`.

## What The Package Supports

The current package includes:
- spec v3
- a generic planning model in ticket front matter
- repo-level semantic overrides through `.tickets/config.yml`
- optional advisory claims for swarm coordination
- the same workflow available through both `TICKETS.md` and `.tickets/skills/tickets/SKILL.md`

Default semantic mapping:
- `feature` -> `planning.node_type=group`
- `phase` -> `planning.lane`
- `milestone` -> `planning.node_type=checkpoint`
- `roadmap` -> `planning.horizon`

Key shipped files:
- `packages/tickets/.tickets/spec/TICKETS.md`
- `packages/tickets/.tickets/spec/AGENTS_EXAMPLE.md`
- `packages/tickets/.tickets/spec/profile/defaults.yml`
- `packages/tickets/.tickets/spec/version/20260317-4-tickets-spec.md`

## Where To Make A Change

- change CLI behavior in `packages/tickets/src`
- change validation or repair behavior in `packages/tickets/src` and `packages/tickets/tests`
- change shipped templates, defaults, or specs in `packages/tickets/.tickets/spec`
- change package docs in `packages/tickets/README.md`
- change the docs site in `apps/site`

The root docs explain how to work on this package. The files under `packages/tickets/.tickets/spec/` are the copies the package ships.

Do not work on this repository as though the package had been initialized into it. In particular, do not use `init --apply` to maintain the root docs.

## Workspaces

- `@picoai/tickets`: `packages/tickets`
- `@picoai/tickets-site`: `apps/site`

## Common Commands

```bash
npm install
npm run test
npm run test:cli
npm run build
npm run tickets -- --help
```

## Before You Finish

If you changed package behavior, check:
- tests still pass
- shipped templates and specs still match the implementation
- package docs still describe the shipped behavior clearly
- root docs still read like maintainer docs, not installed package files

## References

- Contributor workflow: `AGENTS.md`
- Shipped package README: `packages/tickets/README.md`
- Contribution guide: `CONTRIBUTING.md`
