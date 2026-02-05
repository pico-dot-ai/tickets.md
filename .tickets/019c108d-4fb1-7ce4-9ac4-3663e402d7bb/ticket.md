---
id: 019c108d-4fb1-7ce4-9ac4-3663e402d7bb
title: Feature Alpha epic (parent ticket)
status: doing
created_at: '2026-01-30T20:17:02Z'
priority: high
labels:
- epic
- planning
assignment:
  mode: mixed
  owner: team:core
related:
- 019c108d-4fb2-70d2-96bd-d90cd1bd55d3
- 019c108d-4fb3-7fc1-a1d4-c57c6f57e0e1
- 019c108d-4fb4-7c84-a97d-9ea3aaa56fe5
- 019c108d-4fb5-78ed-8ece-b1afdf9b7f85
- 019c108d-4fb6-79f9-8813-bc0ef7e74b06
agent_limits:
  iteration_timebox_minutes: 20
  max_iterations: 6
  max_tool_calls: 80
  checkpoint_every_minutes: 5
verification:
  commands:
  - python -m pytest
  - ./tkt_md/scripts/tickets validate
---
# Ticket

## Description
Track delivery of Feature Alpha and coordinate child tickets.

## Acceptance Criteria
- [ ] Children tickets created and linked
- [ ] Rollup status kept current
- [ ] Release plan agreed

## Verification
- ./tkt_md/scripts/tickets validate
