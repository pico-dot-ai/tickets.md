# Ticket Format Spec (Version 1)

- Version: 1
- Version URL: `version/20260205-tickets-spec.md`
- Released: 2026-02-05
- Status: superseded

## Definition (format only)
This version defines the ticket and log formats used by this repo. It does not define workflow policy; see `TICKETS.md` for full workflow.

### Ticket front matter (required)
- `id`: lowercase UUIDv7 string
- `version`: format version (integer)
- `version_url`: path to this definition (repo-local, relative to `.tickets/spec/`)
- `title`: string
- `status`: `todo|doing|blocked|done|canceled`
- `created_at`: ISO 8601 UTC timestamp

### Log entry (required)
- `version`: format version (integer)
- `version_url`: path to this definition (repo-local, relative to `.tickets/spec/`)
- `ts`: ISO 8601 UTC timestamp
- `run_started`: ISO 8601 UTC timestamp
- `actor_type`: `human|agent`
- `actor_id`: string
- `summary`: short string
- `context`: `[...]` (bullets capturing run context)

### Extensions
- Extensions are repo-local and must live under the `custom` key.
- Tools should ignore unknown keys under `custom`.

## Diff from previous version
- Initial version (no previous version).
