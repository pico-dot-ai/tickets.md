# @picoai/tickets

Repo-native ticketing CLI for Markdown-first, append-only ticket workflows.

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
npx @picoai/tickets init --apply
npx @picoai/tickets new --title "Short title"
npx @picoai/tickets validate
```

## Commands

- `init`
- `new`
- `validate`
- `repair`
- `status`
- `log`
- `list`
- `graph`

## Assets shipped with this package

- `.tickets/spec/TICKETS.md` template source
- `.tickets/spec/AGENTS_EXAMPLE.md`
- `.tickets/spec/version/*`

These are used by `init` to bootstrap target repositories.
`init` writes `AGENTS_EXAMPLE.md` at the target repo root from the bundled template.
With `--apply`, `init` upserts/creates a managed section in `AGENTS.md` from that template and does not create `AGENTS_EXAMPLE.md` in the target repo.
With `--apply`, `TICKETS.md` is updated additively via a managed block (timestamp + tool/spec version metadata), rather than being overwritten.
