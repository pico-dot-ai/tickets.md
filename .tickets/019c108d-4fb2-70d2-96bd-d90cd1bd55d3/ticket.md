---
id: 019c108d-4fb2-70d2-96bd-d90cd1bd55d3
title: Feature Alpha API backend
status: doing
created_at: '2026-01-30T20:17:02Z'
priority: high
labels:
- backend
- api
assignment:
  mode: agent_only
  owner: agent:codex
dependencies:
- 019c108d-4fb1-7ce4-9ac4-3663e402d7bb
blocks:
- 019c108d-4fb3-7fc1-a1d4-c57c6f57e0e1
- 019c108d-4fb4-7c84-a97d-9ea3aaa56fe5
- 019c108d-4fb6-79f9-8813-bc0ef7e74b06
agent_limits:
  iteration_timebox_minutes: 15
  max_iterations: 4
  max_tool_calls: 60
  checkpoint_every_minutes: 5
verification:
  commands:
  - npm test
---
# Ticket

## Description
Implement service endpoints and data model for Feature Alpha.

## Acceptance Criteria
- [ ] Endpoints implemented
- [ ] Schema migrations applied
- [ ] Integration tests pass

## Verification
- npm test
- curl http://localhost:8000/health
