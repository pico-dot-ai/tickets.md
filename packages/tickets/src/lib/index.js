import fs from "node:fs";
import path from "node:path";

import {
  FORMAT_VERSION,
  FORMAT_VERSION_URL,
  PLANNING_INDEX_FORMAT_ID,
  PLANNING_INDEX_FORMAT_LABEL,
} from "./constants.js";
import { loadClaimEvents, deriveActiveClaim } from "./claims.js";
import { loadWorkflowProfile, repoConfigPath } from "./config.js";
import { buildPlanningSnapshotFromRows, normalizePlanning } from "./planning.js";
import { collectTicketPaths } from "./validation.js";
import { ensureDir, loadTicket, readJsonl, repoRoot, ticketsDir } from "./util.js";

function fileSignature(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath);
  return `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
}

function listLogFiles(logsDir) {
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  return fs
    .readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function computeLastUpdated(logsDir) {
  let latest = "";

  for (const name of listLogFiles(logsDir)) {
    const logPath = path.join(logsDir, name);
    for (const entry of readJsonl(logPath)) {
      const ts = entry.ts;
      if (typeof ts === "string" && (latest === "" || ts > latest)) {
        latest = ts;
      }
    }
  }

  return latest;
}

function ticketPathsForRoot(root = repoRoot()) {
  const previous = process.cwd();
  try {
    process.chdir(root);
    return collectTicketPaths(null);
  } finally {
    process.chdir(previous);
  }
}

function collectSourceState(root = repoRoot()) {
  const configPath = repoConfigPath(root);
  const ticketStates = ticketPathsForRoot(root)
    .map((ticketPath) => {
      const ticketDir = path.dirname(ticketPath);
      const logsDir = path.join(ticketDir, "logs");
      const logFiles = listLogFiles(logsDir);
      return {
        id: path.basename(ticketDir),
        ticket_path: path.relative(root, ticketPath),
        ticket_signature: fileSignature(ticketPath),
        log_count: logFiles.length,
        logs: logFiles.map((name) => ({
          name,
          signature: fileSignature(path.join(logsDir, name)),
        })),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    config_fingerprint: fileSignature(configPath),
    ticket_count: ticketStates.length,
    tickets: ticketStates,
  };
}

function buildRows(root = repoRoot(), profile = loadWorkflowProfile(root)) {
  const rows = [];

  for (const ticketPath of ticketPathsForRoot(root)) {
    try {
      const [frontMatter, body] = loadTicket(ticketPath);
      const ticketDir = path.dirname(ticketPath);
      const logsDir = path.join(ticketDir, "logs");
      const activeClaim = deriveActiveClaim(loadClaimEvents(logsDir));

      rows.push({
        id: frontMatter.id ?? "",
        title: frontMatter.title ?? "",
        status: frontMatter.status ?? "",
        priority: frontMatter.priority ?? "",
        owner: frontMatter.assignment?.owner ?? null,
        mode: frontMatter.assignment?.mode ?? null,
        labels: Array.isArray(frontMatter.labels)
          ? frontMatter.labels.filter((label) => typeof label === "string")
          : [],
        body: body ?? "",
        path: ticketPath,
        dependencies: Array.isArray(frontMatter.dependencies) ? frontMatter.dependencies : [],
        blocks: Array.isArray(frontMatter.blocks) ? frontMatter.blocks : [],
        related: Array.isArray(frontMatter.related) ? frontMatter.related : [],
        planning: normalizePlanning(frontMatter, profile),
        resolution: frontMatter.resolution ?? null,
        active_claim: activeClaim,
        last_updated: computeLastUpdated(logsDir),
      });
    } catch {
      // Invalid tickets are surfaced by `validate`; derived views skip them.
    }
  }

  return rows;
}

function indexPath(root = repoRoot()) {
  return path.join(root, ".tickets", "derived", "planning-index.json");
}

function serializeMap(map) {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, [...value]]));
}

function buildIndexDocument(root = repoRoot()) {
  const profile = loadWorkflowProfile(root);
  const rows = buildRows(root, profile);
  const snapshot = buildPlanningSnapshotFromRows(rows, profile);

  return {
    index_format_id: PLANNING_INDEX_FORMAT_ID,
    index_format_label: PLANNING_INDEX_FORMAT_LABEL,
    tool: {
      format_version: FORMAT_VERSION,
      format_version_url: FORMAT_VERSION_URL,
    },
    source_state: collectSourceState(root),
    profile,
    rows: snapshot.rows,
    predecessors_by_id: serializeMap(snapshot.predecessorsById),
    members_by_group: serializeMap(snapshot.membersByGroup),
  };
}

function readIndex(root = repoRoot()) {
  const outPath = indexPath(root);
  if (!fs.existsSync(outPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch {
    return null;
  }
}

function isFresh(index, root = repoRoot()) {
  if (!index) {
    return false;
  }
  if (index.index_format_id !== PLANNING_INDEX_FORMAT_ID) {
    return false;
  }
  if (index.tool?.format_version !== FORMAT_VERSION) {
    return false;
  }
  if (index.tool?.format_version_url !== FORMAT_VERSION_URL) {
    return false;
  }

  const currentState = collectSourceState(root);
  return JSON.stringify(index.source_state ?? null) === JSON.stringify(currentState);
}

export function planningIndexPath(root = repoRoot()) {
  return indexPath(root);
}

export function invalidatePlanningIndex(root = repoRoot()) {
  const outPath = indexPath(root);
  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }
}

export function rebuildPlanningIndex(root = repoRoot()) {
  const outPath = indexPath(root);
  ensureDir(path.dirname(outPath));
  const index = buildIndexDocument(root);
  fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`);
  return buildPlanningSnapshotFromRows(index.rows, index.profile);
}

export function refreshPlanningIndexIfPresent(root = repoRoot()) {
  const outPath = indexPath(root);
  if (!fs.existsSync(outPath)) {
    return null;
  }

  try {
    return rebuildPlanningIndex(root);
  } catch {
    invalidatePlanningIndex(root);
    return null;
  }
}

export function loadPlanningSnapshot(options = {}) {
  const root = options.root ?? repoRoot();
  const persist = options.persist ?? true;
  const existing = readIndex(root);
  if (existing && isFresh(existing, root)) {
    return buildPlanningSnapshotFromRows(existing.rows ?? [], existing.profile ?? loadWorkflowProfile(root));
  }

  if (!persist) {
    const profile = loadWorkflowProfile(root);
    return buildPlanningSnapshotFromRows(buildRows(root, profile), profile);
  }

  return rebuildPlanningIndex(root);
}

export function currentSourceState(root = repoRoot()) {
  return collectSourceState(root);
}

export function planningIndexExists(root = repoRoot()) {
  return fs.existsSync(indexPath(root));
}
