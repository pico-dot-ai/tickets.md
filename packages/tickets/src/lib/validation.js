import fs from "node:fs";
import path from "node:path";

import {
  ASSIGNMENT_MODE_VALUES,
  CLAIM_ACTION_VALUES,
  PLANNING_NODE_TYPES,
  PRIORITY_VALUES,
  RESOLUTION_VALUES,
  STATUS_VALUES,
} from "./constants.js";
import {
  isUuidv7,
  listTicketDirs,
  loadTicket,
  parseIso,
  readJsonl,
  repoRoot,
} from "./util.js";

function parseVersion(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function collectTicketPaths(target) {
  if (target) {
    const resolved = path.resolve(repoRoot(), target);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return [path.join(resolved, "ticket.md")];
    }
    return [resolved];
  }

  return listTicketDirs()
    .map((ticketDir) => path.join(ticketDir, "ticket.md"))
    .filter((ticketPath) => fs.existsSync(ticketPath));
}

export function validateTicket(ticketPath, allFields = false) {
  const issues = [];
  let frontMatter;
  let body;

  try {
    [frontMatter, body] = loadTicket(ticketPath);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "TICKET_FRONT_MATTER_INVALID",
      message: String(error.message ?? error),
      ticket_path: ticketPath,
    });
    return [issues, {}, ""];
  }

  const requiredFields = ["id", "title", "status", "created_at"];
  for (const field of requiredFields) {
    if (!(field in frontMatter)) {
      issues.push({
        severity: "error",
        code: `MISSING_${field.toUpperCase()}`,
        message: `Missing ${field}`,
        ticket_path: ticketPath,
      });
    }
  }

  if (!("version" in frontMatter)) {
    issues.push({
      severity: "warning",
      code: "VERSION_MISSING",
      message: "Missing version (assume 1 for legacy tickets)",
      ticket_path: ticketPath,
    });
  } else {
    const version = parseVersion(frontMatter.version);
    if (version === null || version <= 0) {
      issues.push({
        severity: "error",
        code: "VERSION_INVALID",
        message: "version must be a positive integer",
        ticket_path: ticketPath,
      });
    }

    if (!("version_url" in frontMatter)) {
      issues.push({
        severity: "error",
        code: "VERSION_URL_MISSING",
        message: "version_url required when version is present",
        ticket_path: ticketPath,
      });
    } else if (typeof frontMatter.version_url !== "string" || !frontMatter.version_url.trim()) {
      issues.push({
        severity: "error",
        code: "VERSION_URL_INVALID",
        message: "version_url must be a non-empty string",
        ticket_path: ticketPath,
      });
    }
  }

  if ("version_url" in frontMatter && !("version" in frontMatter)) {
    issues.push({
      severity: "warning",
      code: "VERSION_URL_WITHOUT_VERSION",
      message: "version_url present without version",
      ticket_path: ticketPath,
    });
  }

  if ("id" in frontMatter && (!isUuidv7(frontMatter.id) || typeof frontMatter.id !== "string")) {
    issues.push({
      severity: "error",
      code: "ID_NOT_UUIDV7",
      message: "id must be UUIDv7",
      ticket_path: ticketPath,
    });
  }

  if ("created_at" in frontMatter) {
    if (typeof frontMatter.created_at !== "string" || !parseIso(frontMatter.created_at)) {
      issues.push({
        severity: "error",
        code: "CREATED_AT_INVALID",
        message: "created_at must be ISO8601 UTC",
        ticket_path: ticketPath,
      });
    }
  }

  if ("status" in frontMatter && !STATUS_VALUES.includes(frontMatter.status)) {
    issues.push({
      severity: "error",
      code: "STATUS_INVALID",
      message: "status invalid",
      ticket_path: ticketPath,
    });
  }

  if ("assignment" in frontMatter) {
    if (!frontMatter.assignment || typeof frontMatter.assignment !== "object" || Array.isArray(frontMatter.assignment)) {
      issues.push({
        severity: "error",
        code: "ASSIGNMENT_INVALID",
        message: "assignment must be mapping",
        ticket_path: ticketPath,
      });
    } else {
      const mode = frontMatter.assignment.mode;
      if (mode && !ASSIGNMENT_MODE_VALUES.includes(mode)) {
        issues.push({
          severity: "error",
          code: "ASSIGNMENT_MODE_INVALID",
          message: "assignment.mode invalid",
          ticket_path: ticketPath,
        });
      }
    }
  }

  if ("custom" in frontMatter && (typeof frontMatter.custom !== "object" || !frontMatter.custom || Array.isArray(frontMatter.custom))) {
    issues.push({
      severity: "error",
      code: "CUSTOM_INVALID",
      message: "custom must be mapping",
      ticket_path: ticketPath,
    });
  }

  const relationshipKeys = ["dependencies", "blocks", "related"];
  for (const relationshipKey of relationshipKeys) {
    if (!(relationshipKey in frontMatter)) {
      continue;
    }

    const value = frontMatter[relationshipKey];
    if (!Array.isArray(value)) {
      issues.push({
        severity: "error",
        code: "RELATIONSHIP_TYPE_INVALID",
        message: `${relationshipKey} must be list`,
        ticket_path: ticketPath,
      });
      continue;
    }

    for (const relationship of value) {
      if (typeof relationship !== "string" || !isUuidv7(relationship)) {
        issues.push({
          severity: "error",
          code: "RELATIONSHIP_ID_INVALID",
          message: `${relationshipKey} entries must be UUIDv7`,
          ticket_path: ticketPath,
        });
      }
    }
  }

  for (const forbidden of ["parent", "subtickets", "supersedes", "duplicate_of"]) {
    if (forbidden in frontMatter) {
      issues.push({
        severity: "error",
        code: "RELATIONSHIP_KEY_FORBIDDEN",
        message: `${forbidden} not allowed in ticket.md`,
        ticket_path: ticketPath,
      });
    }
  }

  if ("planning" in frontMatter) {
    const planning = frontMatter.planning;
    if (!planning || typeof planning !== "object" || Array.isArray(planning)) {
      issues.push({
        severity: "error",
        code: "PLANNING_INVALID",
        message: "planning must be mapping",
        ticket_path: ticketPath,
      });
    } else {
      if ("node_type" in planning && !PLANNING_NODE_TYPES.includes(planning.node_type)) {
        issues.push({
          severity: "error",
          code: "PLANNING_NODE_TYPE_INVALID",
          message: `planning.node_type must be one of ${PLANNING_NODE_TYPES.join("|")}`,
          ticket_path: ticketPath,
        });
      }

      for (const key of ["group_ids", "precedes"]) {
        if (!(key in planning)) {
          continue;
        }
        if (!Array.isArray(planning[key])) {
          issues.push({
            severity: "error",
            code: "PLANNING_RELATIONSHIP_INVALID",
            message: `planning.${key} must be list`,
            ticket_path: ticketPath,
          });
          continue;
        }
        for (const relation of planning[key]) {
          if (typeof relation !== "string" || !isUuidv7(relation)) {
            issues.push({
              severity: "error",
              code: "PLANNING_RELATIONSHIP_ID_INVALID",
              message: `planning.${key} entries must be UUIDv7`,
              ticket_path: ticketPath,
            });
          }
        }
      }

      for (const key of ["lane", "horizon"]) {
        if (key in planning && planning[key] !== null && typeof planning[key] !== "string") {
          issues.push({
            severity: "error",
            code: "PLANNING_SCALAR_INVALID",
            message: `planning.${key} must be string or null`,
            ticket_path: ticketPath,
          });
        }
      }

      if ("rank" in planning && planning.rank !== null && (!Number.isInteger(planning.rank) || planning.rank <= 0)) {
        issues.push({
          severity: "error",
          code: "PLANNING_RANK_INVALID",
          message: "planning.rank must be a positive integer or null",
          ticket_path: ticketPath,
        });
      }
    }
  }

  if ("resolution" in frontMatter) {
    if (frontMatter.resolution !== null && !RESOLUTION_VALUES.includes(frontMatter.resolution)) {
      issues.push({
        severity: "error",
        code: "RESOLUTION_INVALID",
        message: `resolution must be one of ${RESOLUTION_VALUES.join("|")} or null`,
        ticket_path: ticketPath,
      });
    } else if (frontMatter.resolution !== null && !["done", "canceled"].includes(frontMatter.status)) {
      issues.push({
        severity: "error",
        code: "RESOLUTION_STATUS_INVALID",
        message: "resolution requires terminal status done|canceled",
        ticket_path: ticketPath,
      });
    }
  }

  if ("agent_limits" in frontMatter) {
    if (!frontMatter.agent_limits || typeof frontMatter.agent_limits !== "object" || Array.isArray(frontMatter.agent_limits)) {
      issues.push({
        severity: "error",
        code: "AGENT_LIMITS_INVALID",
        message: "agent_limits must be mapping",
        ticket_path: ticketPath,
      });
    } else {
      for (const key of [
        "iteration_timebox_minutes",
        "max_iterations",
        "max_tool_calls",
        "checkpoint_every_minutes",
      ]) {
        if (!(key in frontMatter.agent_limits)) {
          continue;
        }
        const value = frontMatter.agent_limits[key];
        if (!Number.isInteger(value) || value <= 0) {
          issues.push({
            severity: "error",
            code: "AGENT_LIMIT_VALUE_INVALID",
            message: `${key} must be positive int`,
            ticket_path: ticketPath,
          });
        }
      }
    }
  }

  if (allFields) {
    if ("priority" in frontMatter && !PRIORITY_VALUES.includes(frontMatter.priority)) {
      issues.push({
        severity: "error",
        code: "PRIORITY_INVALID",
        message: "priority must be low|medium|high|critical",
        ticket_path: ticketPath,
        optional: true,
      });
    }

    if ("labels" in frontMatter) {
      if (!Array.isArray(frontMatter.labels)) {
        issues.push({
          severity: "error",
          code: "LABELS_NOT_LIST",
          message: "labels must be list of strings",
          ticket_path: ticketPath,
          optional: true,
        });
      } else {
        for (const label of frontMatter.labels) {
          if (typeof label !== "string") {
            issues.push({
              severity: "error",
              code: "LABEL_INVALID_ENTRY",
              message: "labels entries must be strings",
              ticket_path: ticketPath,
              optional: true,
            });
          }
        }
      }
    }

    if (
      frontMatter.assignment &&
      typeof frontMatter.assignment === "object" &&
      !Array.isArray(frontMatter.assignment)
    ) {
      const owner = frontMatter.assignment.owner;
      if (owner !== undefined && owner !== null && typeof owner !== "string") {
        issues.push({
          severity: "error",
          code: "ASSIGNMENT_OWNER_INVALID",
          message: "assignment.owner must be string",
          ticket_path: ticketPath,
          optional: true,
        });
      }
    }

    if ("verification" in frontMatter) {
      const verification = frontMatter.verification;
      if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
        issues.push({
          severity: "error",
          code: "VERIFICATION_INVALID",
          message: "verification must be mapping",
          ticket_path: ticketPath,
          optional: true,
        });
      } else {
        const commands = verification.commands;
        if (commands !== undefined && !Array.isArray(commands)) {
          issues.push({
            severity: "error",
            code: "VERIFICATION_COMMANDS_INVALID",
            message: "verification.commands must be list of strings",
            ticket_path: ticketPath,
            optional: true,
          });
        } else if (Array.isArray(commands)) {
          for (const command of commands) {
            if (typeof command !== "string") {
              issues.push({
                severity: "error",
                code: "VERIFICATION_COMMAND_INVALID",
                message: "verification.commands entries must be strings",
                ticket_path: ticketPath,
                optional: true,
              });
            }
          }
        }
      }
    }
  }

  for (const heading of ["# Ticket", "## Description", "## Acceptance Criteria", "## Verification"]) {
    if (!body.includes(heading)) {
      issues.push({
        severity: "error",
        code: "MISSING_SECTION",
        message: `Missing section ${heading}`,
        ticket_path: ticketPath,
      });
    }
  }

  return [issues, frontMatter, body];
}

function loadPlanningRows(ticketPaths) {
  const rows = [];

  for (const ticketPath of ticketPaths) {
    try {
      const [frontMatter] = loadTicket(ticketPath);
      rows.push({
        ticket_path: ticketPath,
        id: frontMatter.id ?? "",
        status: frontMatter.status ?? "",
        dependencies: Array.isArray(frontMatter.dependencies) ? frontMatter.dependencies : [],
        blocks: Array.isArray(frontMatter.blocks) ? frontMatter.blocks : [],
        related: Array.isArray(frontMatter.related) ? frontMatter.related : [],
        planning: {
          node_type: frontMatter.planning?.node_type ?? "work",
          group_ids: Array.isArray(frontMatter.planning?.group_ids) ? frontMatter.planning.group_ids : [],
          lane: frontMatter.planning?.lane ?? null,
          rank: frontMatter.planning?.rank ?? null,
          horizon: frontMatter.planning?.horizon ?? null,
          precedes: Array.isArray(frontMatter.planning?.precedes) ? frontMatter.planning.precedes : [],
        },
      });
    } catch {
      // Ticket parsing errors are already surfaced by validateTicket.
    }
  }

  return rows;
}

function relationshipIssue(ticketPath, code, message) {
  return {
    severity: "error",
    code,
    message,
    ticket_path: ticketPath,
  };
}

function collectCycleNodes(adjacency) {
  const state = new Map();
  const cycleNodes = new Set();
  const stack = [];

  function visit(nodeId) {
    const status = state.get(nodeId) ?? 0;
    if (status === 1) {
      const startIndex = stack.indexOf(nodeId);
      for (const entry of stack.slice(startIndex)) {
        cycleNodes.add(entry);
      }
      cycleNodes.add(nodeId);
      return;
    }
    if (status === 2) {
      return;
    }

    state.set(nodeId, 1);
    stack.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      visit(nextId);
    }
    stack.pop();
    state.set(nodeId, 2);
  }

  for (const nodeId of adjacency.keys()) {
    visit(nodeId);
  }

  return cycleNodes;
}

export function validatePlanningTopology(targetTicketPaths, allTicketPaths = targetTicketPaths) {
  const issues = [];
  const allRows = loadPlanningRows(allTicketPaths);
  const rowsById = new Map(allRows.map((row) => [row.id, row]));
  const targetPaths = new Set(targetTicketPaths);
  const targetRows = allRows.filter((row) => targetPaths.has(row.ticket_path));

  for (const row of targetRows) {
    for (const [key, values] of [
      ["dependencies", row.dependencies],
      ["blocks", row.blocks],
      ["related", row.related],
    ]) {
      for (const relationId of values) {
        if (typeof relationId === "string" && isUuidv7(relationId) && !rowsById.has(relationId)) {
          issues.push(
            relationshipIssue(row.ticket_path, "RELATIONSHIP_TARGET_MISSING", `${key} references missing ticket ${relationId}`),
          );
        }
      }
    }

    for (const relationId of row.planning.group_ids) {
      if (typeof relationId === "string" && isUuidv7(relationId) && !rowsById.has(relationId)) {
        issues.push(
          relationshipIssue(
            row.ticket_path,
            "PLANNING_TARGET_MISSING",
            `planning.group_ids references missing ticket ${relationId}`,
          ),
        );
        continue;
      }
      const target = rowsById.get(relationId);
      if (target && !["group", "checkpoint"].includes(target.planning.node_type)) {
        issues.push(
          relationshipIssue(
            row.ticket_path,
            "PLANNING_GROUP_TARGET_INVALID",
            `planning.group_ids must reference a group or checkpoint ticket: ${relationId}`,
          ),
        );
      }
    }

    for (const relationId of row.planning.precedes) {
      if (typeof relationId === "string" && isUuidv7(relationId) && !rowsById.has(relationId)) {
        issues.push(
          relationshipIssue(
            row.ticket_path,
            "PLANNING_TARGET_MISSING",
            `planning.precedes references missing ticket ${relationId}`,
          ),
        );
        continue;
      }
      if (relationId === row.id) {
        issues.push(
          relationshipIssue(
            row.ticket_path,
            "PLANNING_PRECEDES_SELF_REFERENCE",
            "planning.precedes must not contain the ticket's own id",
          ),
        );
      }
    }
  }

  const precedesAdjacency = new Map();
  for (const row of allRows) {
    precedesAdjacency.set(row.id, [...row.planning.precedes]);
  }
  const precedesCycles = collectCycleNodes(precedesAdjacency);
  for (const row of targetRows) {
    if (precedesCycles.has(row.id)) {
      issues.push(
        relationshipIssue(row.ticket_path, "PLANNING_PRECEDES_CYCLE", "planning.precedes contains a cycle"),
      );
    }
  }

  const groupAdjacency = new Map();
  for (const row of allRows) {
    if (!["group", "checkpoint"].includes(row.planning.node_type)) {
      continue;
    }
    const edges = row.planning.group_ids.filter((groupId) => {
      const target = rowsById.get(groupId);
      return target && ["group", "checkpoint"].includes(target.planning.node_type);
    });
    groupAdjacency.set(row.id, edges);
  }
  const groupCycles = collectCycleNodes(groupAdjacency);
  for (const row of targetRows) {
    if (groupCycles.has(row.id)) {
      issues.push(
        relationshipIssue(
          row.ticket_path,
          "PLANNING_GROUP_CYCLE",
          "group/checkpoint membership contains a cycle",
        ),
      );
    }
  }

  const ranksByScope = new Map();
  for (const row of allRows) {
    if (!Number.isInteger(row.planning.rank)) {
      continue;
    }
    const scopeKey = JSON.stringify({
      node_type: row.planning.node_type,
      group_ids: [...row.planning.group_ids].sort((a, b) => a.localeCompare(b)),
      lane: row.planning.lane ?? null,
      horizon: row.planning.horizon ?? null,
      rank: row.planning.rank,
    });
    if (!ranksByScope.has(scopeKey)) {
      ranksByScope.set(scopeKey, []);
    }
    ranksByScope.get(scopeKey).push(row);
  }

  for (const rows of ranksByScope.values()) {
    if (rows.length < 2) {
      continue;
    }
    for (const row of rows) {
      if (!targetPaths.has(row.ticket_path)) {
        continue;
      }
      issues.push(
        relationshipIssue(
          row.ticket_path,
          "PLANNING_RANK_CONFLICT",
          "planning.rank conflicts with another ticket in the same peer set",
        ),
      );
    }
  }

  return issues;
}

export function validateRunLog(logPath, machineStrictDefault) {
  const issues = [];
  const filename = path.basename(logPath);
  let expectedPrefix = null;
  if (filename.includes("-")) {
    expectedPrefix = filename.replace(/\.jsonl$/, "").split("-", 1)[0];
  }

  const entries = readJsonl(logPath);
  let runStartedValue = null;

  entries.forEach((entry, idx) => {
    const loc = `${logPath}:${idx + 1}`;
    const machineEntry =
      machineStrictDefault || entry.written_by === "tickets" || entry.machine === true;
    let eventType = null;

    for (const required of ["ts", "run_started", "actor_type", "actor_id", "summary"]) {
      if (!(required in entry)) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "LOG_FIELD_MISSING",
          message: `${required} missing`,
          log: loc,
        });
      }
    }

    if (!("event_type" in entry)) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "LOG_EVENT_TYPE_MISSING",
        message: "event_type missing",
        log: loc,
      });
    } else if (!["status", "work", "claim"].includes(entry.event_type)) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "LOG_EVENT_TYPE_INVALID",
        message: "event_type must be status|work|claim",
        log: loc,
      });
    } else {
      eventType = entry.event_type;
    }

    if (!("version" in entry)) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "LOG_VERSION_MISSING",
        message: "version missing (assume 1 for legacy logs)",
        log: loc,
      });
    } else {
      const version = parseVersion(entry.version);
      if (version === null || version <= 0) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "LOG_VERSION_INVALID",
          message: "version must be a positive integer",
          log: loc,
        });
      }

      if (!("version_url" in entry)) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "LOG_VERSION_URL_MISSING",
          message: "version_url required when version is present",
          log: loc,
        });
      } else if (typeof entry.version_url !== "string" || !entry.version_url.trim()) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "LOG_VERSION_URL_INVALID",
          message: "version_url must be a non-empty string",
          log: loc,
        });
      }
    }

    if ("ts" in entry && !parseIso(entry.ts)) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "TS_INVALID",
        message: "ts not ISO8601",
        log: loc,
      });
    }

    if ("run_started" in entry) {
      if (!parseIso(entry.run_started)) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "RUN_STARTED_INVALID",
          message: "run_started not ISO8601",
          log: loc,
        });
      } else {
        if (!runStartedValue) {
          runStartedValue = entry.run_started;
        } else if (runStartedValue !== entry.run_started) {
          issues.push({
            severity: machineEntry ? "error" : "warning",
            code: "RUN_STARTED_INCONSISTENT",
            message: "run_started differs within file",
            log: loc,
          });
        }

        if (
          expectedPrefix &&
          !entry.run_started.replaceAll(":", "").startsWith(expectedPrefix.replaceAll(":", ""))
        ) {
          issues.push({
            severity: "warning",
            code: "RUN_STARTED_FILENAME_MISMATCH",
            message: "run_started mismatch filename prefix",
            log: loc,
          });
        }
      }
    }

    if ("actor_type" in entry && !["human", "agent"].includes(entry.actor_type)) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "ACTOR_TYPE_INVALID",
        message: "actor_type must be human|agent",
        log: loc,
      });
    }

    if ("context" in entry) {
      if (!Array.isArray(entry.context)) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "CONTEXT_INVALID",
          message: "context must be a list of strings",
          log: loc,
        });
      } else {
        if (machineEntry && eventType === "work" && entry.context.length === 0) {
          issues.push({
            severity: "error",
            code: "CONTEXT_EMPTY",
            message: "context must contain at least one item for machine-written work logs",
            log: loc,
          });
        }
        for (const item of entry.context) {
          if (typeof item !== "string" || !item.trim()) {
            issues.push({
              severity: machineEntry ? "error" : "warning",
              code: "CONTEXT_ENTRY_INVALID",
              message: "context entries must be non-empty strings",
              log: loc,
            });
          }
        }
      }
    } else if (machineEntry && eventType === "work") {
      issues.push({
        severity: "error",
        code: "CONTEXT_MISSING",
        message: "context required for machine-written work logs",
        log: loc,
      });
    }

    if (machineEntry && entry.written_by !== "tickets" && entry.machine !== true) {
      issues.push({
        severity: "error",
        code: "MACHINE_MARKER_MISSING",
        message: "machine marker required",
        log: loc,
      });
    }

    if (eventType === "claim") {
      const claim = entry.claim;
      if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
        issues.push({
          severity: machineEntry ? "error" : "warning",
          code: "CLAIM_INVALID",
          message: "claim event must include claim mapping",
          log: loc,
        });
      } else {
        if (!CLAIM_ACTION_VALUES.includes(claim.action)) {
          issues.push({
            severity: machineEntry ? "error" : "warning",
            code: "CLAIM_ACTION_INVALID",
            message: `claim.action must be one of ${CLAIM_ACTION_VALUES.join("|")}`,
            log: loc,
          });
        }
        if (typeof claim.claim_id !== "string" || !isUuidv7(claim.claim_id)) {
          issues.push({
            severity: machineEntry ? "error" : "warning",
            code: "CLAIM_ID_INVALID",
            message: "claim.claim_id must be UUIDv7",
            log: loc,
          });
        }
        if (typeof claim.holder_id !== "string" || !claim.holder_id.trim()) {
          issues.push({
            severity: machineEntry ? "error" : "warning",
            code: "CLAIM_HOLDER_ID_INVALID",
            message: "claim.holder_id must be non-empty string",
            log: loc,
          });
        }
        if (!["human", "agent"].includes(claim.holder_type)) {
          issues.push({
            severity: machineEntry ? "error" : "warning",
            code: "CLAIM_HOLDER_TYPE_INVALID",
            message: "claim.holder_type must be human|agent",
            log: loc,
          });
        }
        if (claim.action !== "release") {
          if (!Number.isInteger(claim.ttl_minutes) || claim.ttl_minutes <= 0) {
            issues.push({
              severity: machineEntry ? "error" : "warning",
              code: "CLAIM_TTL_INVALID",
              message: "claim.ttl_minutes must be a positive integer",
              log: loc,
            });
          }
          if (!parseIso(claim.expires_at)) {
            issues.push({
              severity: machineEntry ? "error" : "warning",
              code: "CLAIM_EXPIRES_AT_INVALID",
              message: "claim.expires_at must be ISO8601",
              log: loc,
            });
          }
        }
        if ("supersedes_claim_id" in claim && claim.supersedes_claim_id !== null) {
          if (typeof claim.supersedes_claim_id !== "string" || !isUuidv7(claim.supersedes_claim_id)) {
            issues.push({
              severity: machineEntry ? "error" : "warning",
              code: "CLAIM_SUPERSEDES_INVALID",
              message: "claim.supersedes_claim_id must be UUIDv7 or null",
              log: loc,
            });
          }
        }
      }
    }

    if ("custom" in entry && (typeof entry.custom !== "object" || !entry.custom || Array.isArray(entry.custom))) {
      issues.push({
        severity: machineEntry ? "error" : "warning",
        code: "LOG_CUSTOM_INVALID",
        message: "custom must be mapping",
        log: loc,
      });
    }
  });

  return issues;
}
