This file instructs agent harnesses operating in this repository.

This repository contains the source for the `@picoai/tickets` package. Work here should be approached as package development, not as day-to-day use of the package in another repo.

## Ticketing Workflow

### Required Behavior
- First action: read the root `README.md` to understand how this repository is organized and where the shipped template/spec files live.
- When working on user-facing ticketing behavior, consult the canonical shipped templates and specs under `packages/tickets/.tickets/spec/`.
- Use the repo-local CLI (`npx @picoai/tickets`) to test package behavior. Do not treat this repository itself as a repo that has been initialized by the package.
- Before changing package behavior, inspect the implementation in `packages/tickets/src` and the tests in `packages/tickets/tests`.
- Verify relevant changes with `npm run test`, and run `npm run build` when site or documentation changes affect the app.

### Package Asset Locations
- `TICKETS.md` template: `packages/tickets/.tickets/spec/TICKETS.md`
- `AGENTS_EXAMPLE.md` template: `packages/tickets/.tickets/spec/AGENTS_EXAMPLE.md`
- default semantic profile: `packages/tickets/.tickets/spec/profile/defaults.yml`
- versioned specs: `packages/tickets/.tickets/spec/version/`

### Updating Docs And Templates
- Do not use `init --apply` as the workflow for updating this repository’s root docs.
- If you need to change shipped templates or initialization behavior, edit the package assets and implementation directly.

## Local Publishing Policy

This section is repo-local and should remain outside `## Ticketing Workflow` so package-managed workflow examples do not overwrite it.

- Before publishing `@picoai/tickets`, run `npm run release:status` and read the result.
- If HEAD is ahead of the latest recorded npm release and the package version has not changed, bump the package version before publishing.
- Maintain `CHANGELOG.md` with a section for the target package version before publishing.
- Publish only from the `packages/tickets` workspace.
- Use an interactive terminal for publish/auth flows. Do not use token-based or non-interactive publish shortcuts when browser auth is expected.
- If npm authentication is required, use the browser-based flow: run `npm login --auth-type=web` interactively and complete authentication in the browser.
- Run `npm publish` interactively after authentication succeeds.
- Only after publish succeeds, append the new published version/commit/date entry to `packages/tickets/release-history.json`.
- After release provenance is recorded and committed, run `npm run release:tag` from the repo root to push `v<version>` and trigger GitHub Release automation.
