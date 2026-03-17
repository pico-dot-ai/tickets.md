import { listPlanningRows, sortPlanningRows } from "./planning.js";

export function listTickets(snapshot, filters, options = {}) {
  const rows = sortPlanningRows(listPlanningRows(snapshot, filters), options.sortBy, options.reverse);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority ?? "",
    owner: row.owner,
    mode: row.mode,
    node_type: row.planning.node_type,
    lane: row.planning.lane,
    rank: row.planning.rank,
    horizon: row.planning.horizon,
    group_ids: row.planning.group_ids,
    precedes: row.planning.precedes,
    resolution: row.resolution,
    ready: row.ready,
    blocked_by: row.blocked_by,
    active_claim: row.active_claim,
    claim_summary: row.claim_summary,
    last_updated: row.last_updated,
  }));
}
