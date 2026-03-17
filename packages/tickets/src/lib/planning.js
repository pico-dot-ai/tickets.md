const TERMINAL_STATUSES = new Set(["done", "canceled"]);
const GROUP_NODE_TYPES = new Set(["group", "checkpoint"]);
const PRIORITY_ORDER = new Map([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
  ["", 4],
]);

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function normalizePlanning(frontMatter, profile) {
  const planning = frontMatter.planning ?? {};
  return {
    node_type: planning.node_type ?? profile.defaults?.planning?.node_type ?? "work",
    group_ids: Array.isArray(planning.group_ids) ? planning.group_ids : [],
    lane: typeof planning.lane === "string" && planning.lane.trim() ? planning.lane.trim() : null,
    rank: Number.isInteger(planning.rank) ? planning.rank : null,
    horizon: typeof planning.horizon === "string" && planning.horizon.trim() ? planning.horizon.trim() : null,
    precedes: Array.isArray(planning.precedes) ? planning.precedes : [],
  };
}

function cloneRow(row) {
  return {
    ...row,
    labels: Array.isArray(row.labels) ? [...row.labels] : [],
    dependencies: Array.isArray(row.dependencies) ? [...row.dependencies] : [],
    blocks: Array.isArray(row.blocks) ? [...row.blocks] : [],
    related: Array.isArray(row.related) ? [...row.related] : [],
    planning: {
      node_type: row.planning?.node_type ?? "work",
      group_ids: Array.isArray(row.planning?.group_ids) ? [...row.planning.group_ids] : [],
      lane: row.planning?.lane ?? null,
      rank: row.planning?.rank ?? null,
      horizon: row.planning?.horizon ?? null,
      precedes: Array.isArray(row.planning?.precedes) ? [...row.planning.precedes] : [],
    },
    active_claim: row.active_claim ? { ...row.active_claim } : null,
    blocked_by: {
      dependencies: Array.isArray(row.blocked_by?.dependencies) ? [...row.blocked_by.dependencies] : [],
      predecessors: Array.isArray(row.blocked_by?.predecessors) ? [...row.blocked_by.predecessors] : [],
    },
    rollup: row.rollup ? { ...row.rollup } : null,
  };
}

function collectGroupLeaves(groupId, membersByGroup, nodesById, seen = new Set(), leaves = new Set()) {
  if (seen.has(groupId)) {
    return leaves;
  }
  seen.add(groupId);

  for (const childId of membersByGroup.get(groupId) ?? []) {
    const child = nodesById.get(childId);
    if (!child) {
      continue;
    }
    if (child.planning.node_type === "work") {
      leaves.add(child.id);
    } else {
      collectGroupLeaves(child.id, membersByGroup, nodesById, seen, leaves);
    }
  }

  return leaves;
}

function computeRollup(row, membersByGroup, nodesById) {
  if (!GROUP_NODE_TYPES.has(row.planning.node_type)) {
    return null;
  }

  const leafIds = [...collectGroupLeaves(row.id, membersByGroup, nodesById)];
  const leafRows = leafIds.map((id) => nodesById.get(id)).filter(Boolean);
  const merged = leafRows.filter((leaf) => leaf.resolution === "merged").length;
  const dropped = leafRows.filter((leaf) => leaf.resolution === "dropped").length;
  const activeLeafRows = leafRows.filter((leaf) => !["merged", "dropped"].includes(leaf.resolution ?? ""));
  const doneCompleted = activeLeafRows.filter(
    (leaf) => leaf.resolution === "completed" || (leaf.status === "done" && !leaf.resolution),
  ).length;

  return {
    total_leaf: leafRows.length,
    active_leaf: activeLeafRows.length,
    todo: activeLeafRows.filter((leaf) => leaf.status === "todo").length,
    doing: activeLeafRows.filter((leaf) => leaf.status === "doing").length,
    blocked: activeLeafRows.filter((leaf) => leaf.status === "blocked").length,
    done_completed: doneCompleted,
    merged,
    dropped,
    percent_complete: activeLeafRows.length === 0 ? 0 : doneCompleted / activeLeafRows.length,
  };
}

function compareNullableStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function compareNullableNumbers(a, b) {
  const left = Number.isInteger(a) ? a : Number.MAX_SAFE_INTEGER;
  const right = Number.isInteger(b) ? b : Number.MAX_SAFE_INTEGER;
  return left - right;
}

function comparePriority(a, b) {
  const left = PRIORITY_ORDER.get(a.priority ?? "") ?? PRIORITY_ORDER.get("");
  const right = PRIORITY_ORDER.get(b.priority ?? "") ?? PRIORITY_ORDER.get("");
  return left - right;
}

function compareLastUpdated(a, b) {
  return String(b.last_updated ?? "").localeCompare(String(a.last_updated ?? ""));
}

function applyComparatorChain(a, b, comparators) {
  for (const comparator of comparators) {
    const result = comparator(a, b);
    if (result !== 0) {
      return result;
    }
  }
  return 0;
}

function baseOperationalComparators() {
  return [
    (a, b) => compareNullableStrings(a.planning.lane, b.planning.lane),
    (a, b) => compareNullableNumbers(a.planning.rank, b.planning.rank),
    (a, b) => compareNullableStrings(a.title, b.title),
  ];
}

export function formatClaimSummary(activeClaim) {
  if (!activeClaim?.holder_id) {
    return "";
  }
  const until = activeClaim.expires_at ? ` until ${activeClaim.expires_at}` : "";
  return `${activeClaim.holder_id}${until}`;
}

export function buildPlanningSnapshotFromRows(rows, profile) {
  const snapshotRows = rows.map((row) => cloneRow(row));
  const nodesById = new Map(snapshotRows.map((row) => [row.id, row]));
  const predecessorsById = new Map();
  const membersByGroup = new Map();

  for (const row of snapshotRows) {
    for (const successorId of row.planning.precedes) {
      if (!predecessorsById.has(successorId)) {
        predecessorsById.set(successorId, []);
      }
      predecessorsById.get(successorId).push(row.id);
    }
    for (const groupId of row.planning.group_ids) {
      if (!membersByGroup.has(groupId)) {
        membersByGroup.set(groupId, []);
      }
      membersByGroup.get(groupId).push(row.id);
    }
  }

  for (const row of snapshotRows) {
    const unresolvedDependencies = row.dependencies.filter((id) => {
      const dependency = nodesById.get(id);
      return dependency ? !isTerminalStatus(dependency.status) : true;
    });
    const unresolvedPredecessors = (predecessorsById.get(row.id) ?? []).filter((id) => {
      const predecessor = nodesById.get(id);
      return predecessor ? !isTerminalStatus(predecessor.status) : true;
    });

    row.blocked_by = {
      dependencies: unresolvedDependencies,
      predecessors: unresolvedPredecessors,
    };
    row.ready =
      row.planning.node_type === "work" &&
      !isTerminalStatus(row.status) &&
      row.mode !== "human_only" &&
      unresolvedDependencies.length === 0 &&
      unresolvedPredecessors.length === 0;
    row.claim_summary = formatClaimSummary(row.active_claim);
    row.rollup = computeRollup(row, membersByGroup, nodesById);
  }

  return {
    profile,
    rows: snapshotRows,
    nodesById,
    predecessorsById,
    membersByGroup,
  };
}

function passesFilters(row, filters) {
  if (filters.status && row.status !== filters.status) {
    return false;
  }
  if (filters.priority && row.priority !== filters.priority) {
    return false;
  }
  if (filters.mode && row.mode !== filters.mode) {
    return false;
  }
  if (filters.owner && row.owner !== filters.owner) {
    return false;
  }
  if (filters.label && !row.labels.includes(filters.label)) {
    return false;
  }
  if (filters.text) {
    const needle = String(filters.text).toLowerCase();
    const haystack = `${row.title}\n${row.body}`.toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  if (filters.nodeType && row.planning.node_type !== filters.nodeType) {
    return false;
  }
  if (filters.group && !row.planning.group_ids.includes(filters.group)) {
    return false;
  }
  if (filters.lane && row.planning.lane !== filters.lane) {
    return false;
  }
  if (filters.horizon && row.planning.horizon !== filters.horizon) {
    return false;
  }
  if (filters.claimed && !row.active_claim) {
    return false;
  }
  if (filters.claimedBy && row.active_claim?.holder_id !== filters.claimedBy) {
    return false;
  }
  if (filters.ready && !row.ready) {
    return false;
  }
  return true;
}

export function listPlanningRows(snapshot, filters = {}) {
  return snapshot.rows.filter((row) => passesFilters(row, filters));
}

export function sortPlanningRows(rows, sortBy = null, reverse = false) {
  const comparatorsBySort = {
    default: [
      (a, b) => Number(b.ready) - Number(a.ready),
      comparePriority,
      ...baseOperationalComparators(),
      compareLastUpdated,
      (a, b) => compareNullableStrings(a.title, b.title),
    ],
    ready: [
      (a, b) => Number(b.ready) - Number(a.ready),
      ...baseOperationalComparators(),
      comparePriority,
      compareLastUpdated,
    ],
    priority: [comparePriority, ...baseOperationalComparators(), compareLastUpdated],
    lane: [...baseOperationalComparators(), comparePriority, compareLastUpdated],
    rank: [
      (a, b) => compareNullableNumbers(a.planning.rank, b.planning.rank),
      (a, b) => compareNullableStrings(a.planning.lane, b.planning.lane),
      comparePriority,
      compareLastUpdated,
      (a, b) => compareNullableStrings(a.title, b.title),
    ],
    updated: [compareLastUpdated, ...baseOperationalComparators(), comparePriority],
    title: [(a, b) => compareNullableStrings(a.title, b.title), comparePriority, ...baseOperationalComparators()],
  };

  const key = sortBy ?? "default";
  const comparators = comparatorsBySort[key] ?? comparatorsBySort.default;
  const sorted = [...rows].sort((a, b) => applyComparatorChain(a, b, comparators));
  return reverse ? sorted.reverse() : sorted;
}

export function buildGraphData(snapshot, options = {}) {
  const view = options.view ?? "dependency";
  const includeRelated = options.includeRelated ?? false;
  const rootId = options.ticket ?? null;
  const edgeMap = new Map();
  const nodes = new Map(snapshot.rows.map((row) => [row.id, row]));

  function addEdge(type, from, to) {
    const key = `${type}:${from}:${to}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { type, from, to });
    }
  }

  for (const row of snapshot.rows) {
    if (["dependency", "all"].includes(view)) {
      for (const dependency of row.dependencies) {
        addEdge("dependency", dependency, row.id);
      }
      for (const blocked of row.blocks) {
        addEdge("blocks", row.id, blocked);
      }
      if (includeRelated) {
        for (const related of row.related) {
          addEdge("related", row.id, related);
        }
      }
    }

    if (["sequence", "portfolio", "all"].includes(view)) {
      for (const successor of row.planning.precedes) {
        addEdge("precedes", row.id, successor);
      }
    }

    if (["portfolio", "all"].includes(view)) {
      for (const groupId of row.planning.group_ids) {
        addEdge("contains", groupId, row.id);
      }
    }
  }

  let nodeIds = new Set(nodes.keys());
  if (rootId) {
    const queue = [rootId];
    const seen = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const edge of edgeMap.values()) {
        if (edge.from === current && !seen.has(edge.to)) {
          queue.push(edge.to);
        }
        if (edge.to === current && !seen.has(edge.from)) {
          queue.push(edge.from);
        }
      }
    }
    nodeIds = seen;
  }

  const filteredEdges = [...edgeMap.values()].filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const filteredNodes = [...nodeIds].map((id) => nodes.get(id)).filter(Boolean);

  return {
    root_id: rootId,
    nodes: filteredNodes,
    edges: filteredEdges,
  };
}

function collectScopedIds(groupId, membersByGroup) {
  const seen = new Set();
  const queue = [groupId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const childId of membersByGroup.get(current) ?? []) {
      queue.push(childId);
    }
  }

  return seen;
}

function buildPlanRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    node_type: row.planning.node_type,
    lane: row.planning.lane,
    rank: row.planning.rank,
    horizon: row.planning.horizon,
    group_ids: [...row.planning.group_ids],
    active_claim: row.active_claim,
    claim_summary: row.claim_summary,
    owner: row.owner,
    mode: row.mode,
    blocked_by: {
      dependencies: [...row.blocked_by.dependencies],
      predecessors: [...row.blocked_by.predecessors],
    },
  };
}

export function buildPlanSummary(snapshot, options = {}) {
  let rows = snapshot.rows;

  if (options.group) {
    const scopedIds = collectScopedIds(options.group, snapshot.membersByGroup);
    rows = rows.filter((row) => scopedIds.has(row.id));
  }
  if (options.horizon) {
    rows = rows.filter((row) => row.planning.horizon === options.horizon);
  }

  const workRows = rows.filter((row) => row.planning.node_type === "work" && !isTerminalStatus(row.status));
  const ready = sortPlanningRows(
    workRows.filter((row) => row.ready && row.status === "todo"),
    "lane",
    false,
  ).map(buildPlanRow);
  const active = sortPlanningRows(
    workRows.filter((row) => row.status === "doing"),
    "lane",
    false,
  ).map(buildPlanRow);
  const blocked = sortPlanningRows(
    workRows.filter(
      (row) =>
        !row.ready &&
        (row.status === "blocked" || row.blocked_by.dependencies.length > 0 || row.blocked_by.predecessors.length > 0),
    ),
    "lane",
    false,
  ).map(buildPlanRow);
  const groups = sortPlanningRows(
    rows.filter((row) => GROUP_NODE_TYPES.has(row.planning.node_type)),
    "lane",
    false,
  ).map((row) => ({
    id: row.id,
    title: row.title,
    node_type: row.planning.node_type,
    lane: row.planning.lane,
    rank: row.planning.rank,
    horizon: row.planning.horizon,
    rollup: row.rollup,
  }));

  return {
    generated_at: new Date().toISOString(),
    workflow_mode: snapshot.profile.workflow?.mode ?? "auto",
    semantics: snapshot.profile.semantics?.terms ?? {},
    ready,
    active,
    blocked,
    groups,
  };
}
