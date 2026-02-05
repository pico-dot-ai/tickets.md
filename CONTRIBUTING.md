# Contributing

Thanks for your interest in helping improve this project. This repo is built around a lightweight, in-repo ticket system, so contributions are organized a little differently than typical GitHub Issues.

## Quick links
- Contract location: `TICKETS.md`
- CLI entrypoint: `./tkt_md/scripts/tickets`
- Tests: `python -m pytest tkt_md/tests`

## Code of Conduct
Please read `CODE_OF_CONDUCT.md` before contributing. By participating, you agree to follow it.

## How to contribute
There are a few easy ways to help:
- Improve docs or examples
- Add tests or fix bugs
- Propose or implement new features

### 1) Create or pick up a ticket
This project uses in-repo tickets stored under `/.tickets/`. Use the CLI to create one:

```
./tkt_md/scripts/tickets init
./tkt_md/scripts/tickets new --title "Your short title"
```

If you are working from an existing ticket, keep its `ticket.md` stable and log all work via `./tkt_md/scripts/tickets log` when possible.

### 2) Make your change
Follow `TICKETS.md` and keep changes focused. If you touch the ticket format, CLI, or templates, read the section below on contract location and flexibility.

### 3) Verify
Run the relevant checks before opening a PR:

```
./tkt_md/scripts/tickets validate
python -m pytest tkt_md/tests
```

If you are working on the Next.js site in `app/`, you may also want:

```
npm install
npm run dev
```

### 4) Open a PR
Please include:
- A short summary of what changed and why
- The ticket ID you worked on (if applicable)
- Test results you ran

## Contract location and flexibility
This project deliberately defines **where** the contract lives: the repo’s `TICKETS.md`. The intent is that every adopting repo can define its own ticket system by editing its own `TICKETS.md`. Our reference format and tooling are important, but secondary to that principle.
Updates to `TICKETS.md` in this main repo are meant to keep room for new functionality and related systems, and to support changes needed by the in-repo system and CLI.

### What is stable
- In this repo, `TICKETS.md` is the canonical contract. If it conflicts with other docs here, follow `TICKETS.md`.
- In other repos, their `TICKETS.md` is the canonical contract.
- `ticket.md` files should remain human-readable and stable; history belongs in logs.
- Log files are append-only JSONL. Never rewrite or delete log lines.
- The repo-local CLI (`./tkt_md/scripts/tickets`) is the single integration surface for this implementation.

### How we keep it flexible
- The reference format should be easy to adapt: avoid rigid assumptions.
- Prefer additive changes (new optional fields, new CLI flags, new templates).
- Validators should tolerate unknown, non-conflicting keys.
- If you need experimentation, propose a clearly named optional field and document it.

### If you propose a format change
Please include all of the following:
- A spec update in this repo’s `TICKETS.md`
- A version definition update in `tkt_md/version/` (date, full spec, diff at the bottom)
- Template updates (if relevant)
- Validator updates (if relevant)
- A migration or repair path when possible (`./tkt_md/scripts/tickets repair`)
- Tests that cover both old and new behavior

If a change would reduce adaptability for other repos, call that out explicitly. We will be conservative about merging changes that make it harder for adopters to define their own `TICKETS.md`.

## Development setup
Python dependencies for the CLI:

```
python3 -m pip install "PyYAML>=6.0" "uuid6>=2024.1.25"
```

Node dependencies for the site (optional):

```
npm install
```

## Style and quality
- Keep changes minimal and focused.
- Update docs when behavior changes.
- Add tests for new behavior or bug fixes.
- Prefer clarity over cleverness.

Thanks again for contributing.
