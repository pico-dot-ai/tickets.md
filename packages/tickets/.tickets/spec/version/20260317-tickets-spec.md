# Ticket Format Spec (Version 3)

- Version: 3
- Version URL: `version/20260317-tickets-spec.md`
- Released: 2026-03-17
- Status: current

## Definition (format only)
This version defines the ticket, repo config, and log formats used by this repo. Workflow policy and narrative guidance live in `TICKETS.md`.

### Ticket front matter (required)
- `id`: lowercase UUIDv7 string
- `version`: format version (integer)
- `version_url`: path to this definition (repo-local, relative to `.tickets/spec/`)
- `title`: string
- `status`: `todo|doing|blocked|done|canceled`
- `created_at`: ISO 8601 UTC timestamp

### Ticket front matter (optional)
- `priority`: `low|medium|high|critical`
- `labels`: list of strings
- `assignment`: mapping
- `dependencies`: list of ticket IDs
- `blocks`: list of ticket IDs
- `related`: list of ticket IDs
- `planning`: mapping
  - `node_type`: `work|group|checkpoint`
  - `group_ids`: list of ticket IDs
  - `lane`: string or null
  - `rank`: positive integer or null
  - `horizon`: string or null
  - `precedes`: list of ticket IDs
- `resolution`: `completed|merged|dropped|null`
- `agent_limits`: mapping
- `verification`: mapping
- `custom`: mapping

Rules:
- `resolution` is only valid when `status` is terminal (`done` or `canceled`)
- grouping is persisted only through `planning.group_ids`
- sequencing is persisted only through `planning.precedes`

### Repo config (`.tickets/config.yml`)
- `workflow.mode`: `auto|doc_first|skill_first`
- `defaults`: repo-local defaults
- `semantics.terms`: mapping from human-facing terms to generic planning primitives
- `views`: repo-local reporting preferences

Repo config may override defaults and human semantic mappings, but may not redefine CLI invariants, status values, or log schema.

### Log entry (required)
- `version`: format version (integer)
- `version_url`: path to this definition (repo-local, relative to `.tickets/spec/`)
- `ts`: ISO 8601 UTC timestamp
- `run_started`: ISO 8601 UTC timestamp
- `actor_type`: `human|agent`
- `actor_id`: string
- `summary`: short string
- `event_type`: `status|work|claim`

### Log entry (conditional)
- `context`: non-empty list of strings when `event_type: work` and the entry is machine-written
- `claim`: required mapping when `event_type: claim`
  - `action`: `acquire|renew|release|override`
  - `claim_id`: UUIDv7 string
  - `holder_id`: string
  - `holder_type`: `human|agent`
  - `ttl_minutes`: positive integer for non-release events
  - `expires_at`: ISO 8601 UTC timestamp for non-release events
  - `reason`: optional string
  - `supersedes_claim_id`: optional UUIDv7 string or null

### Extensions
- Extensions are repo-local and must live under the `custom` key.
- Tools should ignore unknown keys under `custom`.

## Diff from previous version
- Added the generic planning model under `planning`.
- Added `resolution` to represent terminal work outcomes.
- Added `.tickets/config.yml` as the authoritative repo-local override surface.
- Added `claim` log events and claim payload schema.
- Clarified that the repo skill and `TICKETS.md` are equivalent workflow projections over the same base model.
