import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import yaml from "yaml";

import {
  ASSIGNMENT_MODE_VALUES,
  BASE_DIR,
  DEFAULT_CLAIM_TTL_MINUTES,
  FORMAT_VERSION,
  FORMAT_VERSION_URL,
  GRAPH_VIEW_VALUES,
  LIST_SORT_VALUES,
  PLANNING_NODE_TYPES,
  PRIORITY_VALUES,
  RESOLUTION_VALUES,
  STATUS_VALUES,
} from "./lib/constants.js";
import { deriveActiveClaim, loadClaimEvents } from "./lib/claims.js";
import { loadWorkflowProfile, validateRepoConfig } from "./lib/config.js";
import { invalidatePlanningIndex, loadPlanningSnapshot, refreshPlanningIndexIfPresent } from "./lib/index.js";
import { listTickets } from "./lib/listing.js";
import { buildGraphData, buildPlanSummary } from "./lib/planning.js";
import { syncRepoConfig, syncRepoSkill } from "./lib/projections.js";
import { applyRepairs, loadIssuesFile, runInteractive } from "./lib/repair.js";
import { collectTicketPaths, validatePlanningTopology, validateRunLog, validateTicket } from "./lib/validation.js";
import {
  appendJsonl,
  ensureDir,
  iso8601,
  isoBasic,
  loadTicket,
  newUuidv7,
  nowUtc,
  readTemplate,
  repoRoot,
  resolveTicketPath,
  ticketsDir,
  writeTicket,
} from "./lib/util.js";

function collectOption(value, previous = []) {
  previous.push(value);
  return previous;
}

function hasErrors(issues) {
  return issues.some((issue) => issue.severity === "error");
}

function isValidActorType(value) {
  return ["human", "agent"].includes(value);
}

function resolveActorId(explicitActorId) {
  const candidate = explicitActorId ?? process.env.TICKETS_ACTOR_ID;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }

  const localUser = process.env.USER ?? process.env.USERNAME;
  if (typeof localUser === "string" && localUser.trim()) {
    return `@${localUser.trim()}`;
  }

  return "unknown";
}

function resolveActorType(explicitActorType, actorId) {
  const candidate = explicitActorType ?? process.env.TICKETS_ACTOR_TYPE;
  if (typeof candidate === "string" && candidate.trim()) {
    if (!isValidActorType(candidate.trim())) {
      throw new Error("Invalid actor type. Use one of: human, agent");
    }
    return candidate.trim();
  }

  if (typeof actorId === "string") {
    if (actorId.startsWith("agent:")) {
      return "agent";
    }
    if (actorId.startsWith("@")) {
      return "human";
    }
  }

  return "human";
}

function normalizeContextItems(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function groupIdSignature(groupIds = []) {
  return [...groupIds].sort((a, b) => a.localeCompare(b)).join(",");
}

function resolveGroupTargets(groupIds, snapshot) {
  const targets = [];
  for (const groupId of groupIds ?? []) {
    const row = snapshot.nodesById.get(groupId);
    if (!row) {
      throw new Error(`Unknown --group-id target: ${groupId}`);
    }
    if (!["group", "checkpoint"].includes(row.planning.node_type)) {
      throw new Error(`--group-id must reference a group or checkpoint ticket: ${groupId}`);
    }
    targets.push(row);
  }
  return targets;
}

function inferInheritedScalar(groupTargets, key, optionName) {
  const values = [...new Set(groupTargets.map((row) => row.planning[key]).filter((value) => value))];
  if (values.length > 1) {
    throw new Error(`Cannot infer --${optionName}; referenced groups disagree.`);
  }
  return values[0] ?? null;
}

function inferNextRank(snapshot, planning) {
  if (!planning.lane) {
    return null;
  }

  const signature = groupIdSignature(planning.group_ids);
  let maxRank = 0;
  for (const row of snapshot.rows) {
    if (row.planning.node_type !== planning.node_type) {
      continue;
    }
    if (groupIdSignature(row.planning.group_ids) !== signature) {
      continue;
    }
    if (row.planning.lane !== planning.lane) {
      continue;
    }
    if ((row.planning.horizon ?? null) !== (planning.horizon ?? null)) {
      continue;
    }
    if (Number.isInteger(row.planning.rank) && row.planning.rank > maxRank) {
      maxRank = row.planning.rank;
    }
  }

  return maxRank + 1;
}

function printIssues(issues) {
  for (const issue of issues) {
    const location = issue.ticket_path ?? issue.log ?? issue.config_path ?? "";
    process.stdout.write(`${String(issue.severity ?? "?").toUpperCase()}: ${issue.message} (${location})\n`);
  }
}

function buildRepairsFromIssues(issues, options = {}) {
  const includeOptional = options.includeOptional ?? false;
  const autoEnableSafe = options.autoEnableSafe ?? false;
  const repairs = [];
  const seen = new Set();
  const optionalCodes = new Set([
    "PRIORITY_INVALID",
    "LABELS_NOT_LIST",
    "LABEL_INVALID_ENTRY",
    "ASSIGNMENT_OWNER_INVALID",
    "VERIFICATION_INVALID",
    "VERIFICATION_COMMANDS_INVALID",
    "VERIFICATION_COMMAND_INVALID",
  ]);

  for (const issue of issues) {
    const code = issue.code;
    const ticketPath = issue.ticket_path;
    const logLocation = issue.log;
    const logPath = logLocation ? String(logLocation).replace(/:\d+$/, "") : null;
    if (!ticketPath && !logPath) {
      continue;
    }

    const targetPath = ticketPath ?? logPath;
    const key = `${code}:${targetPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const isOptional = optionalCodes.has(code);
    if (isOptional && !includeOptional) {
      continue;
    }

    const nextId = `R${String(repairs.length + 1).padStart(4, "0")}`;
    const base = {
      id: nextId,
      enabled: false,
      issue_ids: [issue.id ?? ""],
    };
    if (ticketPath) {
      base.ticket_path = ticketPath;
    }
    if (logPath) {
      base.log_path = logPath;
    }

    if (["LOG_EVENT_TYPE_MISSING", "LOG_EVENT_TYPE_INVALID"].includes(code)) {
      repairs.push({
        ...base,
        safe: true,
        action: "set_log_event_type",
        params: {},
        optional: false,
      });
    } else if (["CONTEXT_INVALID", "CONTEXT_EMPTY", "CONTEXT_ENTRY_INVALID", "CONTEXT_MISSING"].includes(code)) {
      repairs.push({
        ...base,
        safe: true,
        action: "normalize_log_context",
        params: {},
        optional: false,
      });
    } else if (code === "MISSING_SECTION") {
      repairs.push({ ...base, safe: true, action: "add_sections", params: {}, optional: false });
    } else if (["VERSION_MISSING", "VERSION_INVALID"].includes(code)) {
      repairs.push({
        ...base,
        safe: true,
        action: "set_front_matter_field",
        params: { field: "version", value: FORMAT_VERSION },
        optional: false,
      });
    } else if (["VERSION_URL_MISSING", "VERSION_URL_INVALID"].includes(code)) {
      repairs.push({
        ...base,
        safe: true,
        action: "set_front_matter_field",
        params: { field: "version_url", value: FORMAT_VERSION_URL },
        optional: false,
      });
    } else if (["CREATED_AT_INVALID", "MISSING_CREATED_AT"].includes(code)) {
      repairs.push({ ...base, safe: true, action: "normalize_created_at", params: {}, optional: false });
    } else if (["ID_NOT_UUIDV7", "MISSING_ID"].includes(code)) {
      repairs.push({
        ...base,
        safe: false,
        action: "set_front_matter_field",
        params: { field: "id", value: null, generate_uuidv7: true, update_references: null },
        optional: false,
      });
    } else if (code === "PRIORITY_INVALID") {
      repairs.push({
        ...base,
        safe: true,
        action: "set_front_matter_field",
        params: { field: "priority", value: "medium" },
        optional: true,
      });
    } else if (code === "LABELS_NOT_LIST") {
      repairs.push({
        ...base,
        safe: true,
        action: "set_front_matter_field",
        params: { field: "labels", value: [] },
        optional: true,
      });
    } else if (code === "LABEL_INVALID_ENTRY") {
      repairs.push({ ...base, safe: true, action: "normalize_labels", params: {}, optional: true });
    } else if (code === "ASSIGNMENT_OWNER_INVALID") {
      repairs.push({
        ...base,
        safe: true,
        action: "set_assignment_owner",
        params: { value: null },
        optional: true,
      });
    } else if (code === "VERIFICATION_INVALID") {
      repairs.push({
        ...base,
        safe: true,
        action: "reset_verification_commands",
        params: { commands: [] },
        optional: true,
      });
    } else if (["VERIFICATION_COMMANDS_INVALID", "VERIFICATION_COMMAND_INVALID"].includes(code)) {
      repairs.push({ ...base, safe: true, action: "normalize_verification_commands", params: {}, optional: true });
    }
  }

  if (autoEnableSafe) {
    for (const repair of repairs) {
      if (repair.safe) {
        repair.enabled = true;
      }
    }
  }

  return repairs;
}

function renderMermaid(graph, includeRelated, timestamp, view) {
  const statusClasses = {
    todo: "fill:#ddd,stroke:#999",
    doing: "fill:#d0e7ff,stroke:#3b82f6",
    blocked: "fill:#ffe4e6,stroke:#ef4444",
    done: "fill:#dcfce7,stroke:#22c55e",
    canceled: "fill:#f3f4f6,stroke:#111827,color:#374151",
  };

  const lines = [
    `# Ticket ${view} graph`,
    `_Generated at ${timestamp} UTC_`,
    "",
    "```mermaid",
    "graph LR",
  ];

  const nodeIds = new Map();
  graph.nodes.forEach((node, idx) => {
    const nodeRef = `n${idx}`;
    nodeIds.set(node.id, nodeRef);
    const title = (node.title || node.id).replaceAll('"', '\\"');
    const metadata = [
      `status=${node.status || "todo"}`,
      `type=${node.planning.node_type ?? ""}`,
      `lane=${node.planning.lane ?? "-"}`,
      `rank=${node.planning.rank ?? "-"}`,
      `horizon=${node.planning.horizon ?? "-"}`,
    ];
    if (node.resolution) {
      metadata.push(`resolution=${node.resolution}`);
    }
    const label = `${title}\\n(${node.id})\\n${metadata.join("\\n")}`;
    const status = (node.status || "todo").toLowerCase();
    lines.push(`  ${nodeRef}["${label}"]:::status_${status}`);
    lines.push(`  click ${nodeRef} "/.tickets/${node.id}/ticket.md" "_blank"`);
  });

  for (const edge of graph.edges) {
    if (edge.type === "related" && !includeRelated) {
      continue;
    }
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    if (!source || !target) {
      continue;
    }
    const connector = edge.type === "contains" ? "-.->" : "-->";
    lines.push(`  ${source} ${connector}|${edge.type}| ${target}`);
  }

  for (const [status, style] of Object.entries(statusClasses)) {
    lines.push(`  classDef status_${status} ${style};`);
  }

  lines.push("```");
  return lines.join("\n");
}

function renderDot(graph, includeRelated) {
  const colors = {
    todo: "#d1d5db",
    doing: "#60a5fa",
    blocked: "#ef4444",
    done: "#22c55e",
    canceled: "#6b7280",
  };

  const lines = [
    "digraph G {",
    "  rankdir=LR;",
    '  node [shape=box, style=filled, color="#cccccc"];',
  ];

  const nodeIds = new Map();
  graph.nodes.forEach((node, idx) => {
    const nodeRef = `n${idx}`;
    nodeIds.set(node.id, nodeRef);
    const status = (node.status || "todo").toLowerCase();
    const color = colors[status] ?? colors.todo;
    const metadata = [
      `status=${status}`,
      `type=${node.planning.node_type ?? ""}`,
      `lane=${node.planning.lane ?? "-"}`,
      `rank=${node.planning.rank ?? "-"}`,
      `horizon=${node.planning.horizon ?? "-"}`,
    ];
    if (node.resolution) {
      metadata.push(`resolution=${node.resolution}`);
    }
    const label = `${node.title || node.id}\\n(${node.id})\\n${metadata.join("\\n")}`;
    lines.push(
      `  ${nodeRef} [label="${label}", fillcolor="${color}", URL="/.tickets/${node.id}/ticket.md", target="_blank"];`,
    );
  });

  for (const edge of graph.edges) {
    if (edge.type === "related" && !includeRelated) {
      continue;
    }
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    if (!source || !target) {
      continue;
    }
    const style = ["related", "contains"].includes(edge.type) ? "dashed" : "solid";
    lines.push(`  ${source} -> ${target} [style=${style}, label="${edge.type}"];`);
  }

  lines.push("}");
  return lines.join("\n");
}

function renderJson(graph, includeRelated) {
  const edges = includeRelated ? graph.edges : graph.edges.filter((edge) => edge.type !== "related");
  return {
    root_id: graph.root_id,
    edges,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      priority: node.priority,
      owner: node.owner,
      mode: node.mode,
      node_type: node.planning.node_type,
      group_ids: node.planning.group_ids,
      lane: node.planning.lane,
      rank: node.planning.rank,
      horizon: node.planning.horizon,
      precedes: node.planning.precedes,
      resolution: node.resolution,
      ready: node.ready,
      href: `/.tickets/${node.id}/ticket.md`,
    })),
  };
}

const AGENTS_LEGACY_SECTION_START = "<!-- @picoai/tickets:agents:start -->";
const AGENTS_LEGACY_SECTION_END = "<!-- @picoai/tickets:agents:end -->";
const AGENTS_SECTION_HEADING = "Ticketing Workflow";
const TICKETS_MANAGED_START = "<!-- @picoai/tickets:managed:start -->";
const TICKETS_MANAGED_END = "<!-- @picoai/tickets:managed:end -->";
const TICKETS_LEGACY_START = "<!-- @picoai/tickets:tickets-md:start -->";
const TICKETS_LEGACY_END = "<!-- @picoai/tickets:tickets-md:end -->";
const TOOL_VERSION = loadToolVersion();

function writeTemplateFile(targetPath, templatePath, apply) {
  if (apply || !fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, readTemplate(templatePath));
  }
}

function loadToolVersion() {
  try {
    const sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(sourceDir, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeContent(content) {
  return content.replaceAll("\r\n", "\n");
}

function stripManagedSection(content, startMarker, endMarker) {
  const normalized = normalizeContent(content);
  const startIndex = normalized.indexOf(startMarker);
  const endIndex = normalized.indexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) {
    return normalized;
  }
  const before = normalized.slice(0, startIndex).trimEnd();
  const after = normalized.slice(endIndex + endMarker.length).trimStart();
  if (!before) {
    return after;
  }
  if (!after) {
    return before;
  }
  return `${before}\n\n${after}`;
}

function parseHeadingLine(line) {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) {
    return null;
  }
  return {
    level: match[1].length,
    text: match[2].trim().toLowerCase(),
  };
}

function findHeadingBlockRange(lines, headingText, headingLevel) {
  const target = headingText.trim().toLowerCase();
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseHeadingLine(lines[index]);
    if (!parsed) {
      continue;
    }
    if (parsed.level === headingLevel && parsed.text === target) {
      start = index;
      break;
    }
  }

  if (start < 0) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const parsed = parseHeadingLine(lines[index]);
    if (!parsed) {
      continue;
    }
    if (parsed.level === headingLevel) {
      end = index;
      break;
    }
  }

  return { start, end };
}

function extractHeadingBlock(content, headingText, headingLevel) {
  const lines = normalizeContent(content).split("\n");
  const range = findHeadingBlockRange(lines, headingText, headingLevel);
  if (!range) {
    return null;
  }
  return lines.slice(range.start, range.end).join("\n").trimEnd();
}

function joinSections(before, managedSection, after) {
  const sections = [];
  if (before) {
    sections.push(before.trimEnd());
  }
  sections.push(managedSection.trimEnd());
  if (after) {
    sections.push(after.trimStart());
  }
  return `${sections.join("\n\n")}\n`;
}

function replaceHeadingBlock(content, replacement, headingText, headingLevel, fallbackLevels = []) {
  const normalized = normalizeContent(content);
  const lines = normalized.split("\n");

  let range = findHeadingBlockRange(lines, headingText, headingLevel);
  if (!range) {
    for (const level of fallbackLevels) {
      range = findHeadingBlockRange(lines, headingText, level);
      if (range) {
        break;
      }
    }
  }

  if (range) {
    const before = lines.slice(0, range.start).join("\n").trimEnd();
    const after = lines.slice(range.end).join("\n").trimStart();
    return joinSections(before, replacement, after);
  }

  if (!normalized.trim()) {
    return `${replacement.trimEnd()}\n`;
  }

  return `${normalized.trimEnd()}\n\n${replacement.trimEnd()}\n`;
}

function replaceLegacyAgentsH1Block(content, replacement) {
  const normalized = normalizeContent(content);
  const lines = normalized.split("\n");
  const h1Range = findHeadingBlockRange(lines, AGENTS_SECTION_HEADING, 1);
  if (!h1Range) {
    return null;
  }

  let end = h1Range.end;
  const bootstrappingRange = findHeadingBlockRange(lines, "Bootstrapping TICKETS.md", 2);
  if (bootstrappingRange && bootstrappingRange.start > h1Range.start) {
    end = lines.length;
    for (let index = bootstrappingRange.end; index < lines.length; index += 1) {
      const parsed = parseHeadingLine(lines[index]);
      if (!parsed) {
        continue;
      }
      if (parsed.level <= 2) {
        end = index;
        break;
      }
    }
  }

  const before = lines.slice(0, h1Range.start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trimStart();
  return joinSections(before, replacement, after);
}

function extractManagedSection(content, startMarker, endMarker) {
  const normalized = normalizeContent(content);
  const startIndex = normalized.indexOf(startMarker);
  const endIndex = normalized.indexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }
  return normalized.slice(startIndex, endIndex + endMarker.length).trimEnd();
}

function injectTicketsManagedMetadata(managedSection) {
  const normalized = normalizeContent(managedSection);
  const lines = normalized.split("\n");
  const headingIndex = lines.findIndex((line) => /^##\s+/.test(line.trim()));
  if (headingIndex < 0) {
    return normalized.trimEnd();
  }

  const metadata = [
    `- applied_at: ${iso8601(nowUtc())}`,
    `- written_by: @picoai/tickets@${TOOL_VERSION}`,
    `- spec_version: ${FORMAT_VERSION}`,
    `- version_url: ${FORMAT_VERSION_URL}`,
  ];

  const before = lines.slice(0, headingIndex + 1);
  const after = lines.slice(headingIndex + 1);
  return [...before, "", ...metadata, "", ...after].join("\n").replaceAll(/\n{3,}/g, "\n\n").trimEnd();
}

function upsertTicketsMdManagedSection(existingContent, templateContent) {
  const managedFromTemplate = extractManagedSection(templateContent, TICKETS_MANAGED_START, TICKETS_MANAGED_END);
  if (!managedFromTemplate) {
    throw new Error("Template is missing managed TICKETS.md markers.");
  }
  const managedSection = injectTicketsManagedMetadata(managedFromTemplate);

  let normalizedExisting = normalizeContent(existingContent);
  normalizedExisting = stripManagedSection(normalizedExisting, TICKETS_LEGACY_START, TICKETS_LEGACY_END);

  const startIndex = normalizedExisting.indexOf(TICKETS_MANAGED_START);
  const endIndex = normalizedExisting.indexOf(TICKETS_MANAGED_END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = normalizedExisting.slice(0, startIndex).trimEnd();
    const after = normalizedExisting.slice(endIndex + TICKETS_MANAGED_END.length).trimStart();
    return joinSections(before, managedSection, after);
  }

  if (!normalizedExisting.trim()) {
    return `${managedSection}\n`;
  }

  return `${normalizedExisting.trimEnd()}\n\n${managedSection}\n`;
}

function syncTicketsMd(root, apply) {
  const ticketsDocPath = path.join(root, "TICKETS.md");
  const templateContent = readTemplate(path.join(".tickets", "spec", "TICKETS.md"));
  const exists = fs.existsSync(ticketsDocPath);

  if (!exists) {
    fs.writeFileSync(ticketsDocPath, templateContent);
  }

  if (apply) {
    const existing = fs.readFileSync(ticketsDocPath, "utf8");
    const next = upsertTicketsMdManagedSection(existing, templateContent);
    if (next !== existing) {
      fs.writeFileSync(ticketsDocPath, next);
    }
  }
}

function upsertAgentsSection(existingContent, templateContent) {
  const managedBlock = extractHeadingBlock(templateContent, AGENTS_SECTION_HEADING, 2);
  if (!managedBlock) {
    throw new Error("Template is missing the managed AGENTS.md heading block.");
  }

  const withoutLegacyMarkers = stripManagedSection(
    normalizeContent(existingContent),
    AGENTS_LEGACY_SECTION_START,
    AGENTS_LEGACY_SECTION_END,
  );
  const lines = normalizeContent(withoutLegacyMarkers).split("\n");
  if (findHeadingBlockRange(lines, AGENTS_SECTION_HEADING, 2)) {
    return replaceHeadingBlock(withoutLegacyMarkers, managedBlock, AGENTS_SECTION_HEADING, 2);
  }

  const migratedLegacyH1 = replaceLegacyAgentsH1Block(withoutLegacyMarkers, managedBlock);
  if (migratedLegacyH1) {
    return migratedLegacyH1;
  }

  return replaceHeadingBlock(withoutLegacyMarkers, managedBlock, AGENTS_SECTION_HEADING, 2);
}

function applyAgentsMdSection(root, templateContent) {
  const agentsMdPath = path.join(root, "AGENTS.md");
  const existing = fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, "utf8") : "";
  const next = upsertAgentsSection(existing, templateContent);
  if (next !== existing) {
    fs.writeFileSync(agentsMdPath, next);
  }
}

function generateExampleTickets() {
  ensureDir(ticketsDir());
  const now = nowUtc();
  const runStarted = isoBasic(now);

  const ids = {
    parent: newUuidv7().toLowerCase(),
    backend: newUuidv7().toLowerCase(),
    frontend: newUuidv7().toLowerCase(),
    testing: newUuidv7().toLowerCase(),
    docs: newUuidv7().toLowerCase(),
    release: newUuidv7().toLowerCase(),
    bugfix: newUuidv7().toLowerCase(),
  };

  const specs = [
    {
      key: "parent",
      title: "Feature Alpha epic (parent ticket)",
      status: "doing",
      priority: "high",
      labels: ["epic", "planning"],
      planning: { node_type: "group", lane: "build", rank: 1, horizon: "current" },
      assignment: { mode: "mixed", owner: "team:core" },
      related: ["backend", "frontend", "testing", "docs", "release"],
      agent_limits: {
        iteration_timebox_minutes: 20,
        max_iterations: 6,
        max_tool_calls: 80,
        checkpoint_every_minutes: 5,
      },
      verification: { commands: ["npm test", "npx @picoai/tickets validate"] },
      body: {
        description: "Track delivery of Feature Alpha and coordinate child tickets.",
        acceptance: [
          "Children tickets created and linked",
          "Rollup status kept current",
          "Release plan agreed",
        ],
        verification: ["npx @picoai/tickets validate"],
      },
      logs: [
        {
          summary: "Epic created and split into child tickets.",
          context: ["Parent planning context for Feature Alpha", "Child tickets were split for parallel execution"],
          tickets_created: ["backend", "frontend", "testing", "docs"],
          next_steps: ["Coordinate release window", "Monitor blockers"],
        },
      ],
    },
    {
      key: "backend",
      title: "Feature Alpha API backend",
      status: "doing",
      priority: "high",
      labels: ["backend", "api"],
      planning: { node_type: "work", group_ids: ["parent"], lane: "build", rank: 1, horizon: "current", precedes: ["frontend", "testing"] },
      assignment: { mode: "agent_only", owner: "agent:codex" },
      dependencies: ["parent"],
      blocks: ["frontend", "testing", "release"],
      agent_limits: {
        iteration_timebox_minutes: 15,
        max_iterations: 4,
        max_tool_calls: 60,
        checkpoint_every_minutes: 5,
      },
      verification: { commands: ["npm test"] },
      body: {
        description: "Implement service endpoints and data model for Feature Alpha.",
        acceptance: ["Endpoints implemented", "Schema migrations applied", "Integration tests pass"],
        verification: ["npm test"],
      },
      logs: [
        {
          summary: "Scaffolded API and outlined endpoints.",
          decisions: ["Using UUID primary keys", "Respond with JSON:API style"],
          created_from: "parent",
          context: ["Acceptance criteria from parent", "Release target"],
        },
        {
          summary: "Agent claimed backend work.",
          event_type: "claim",
          claim: { action: "acquire", holder_id: "agent:codex", holder_type: "agent", ttl_minutes: 60 },
        },
      ],
    },
    {
      key: "frontend",
      title: "Feature Alpha frontend UI",
      status: "todo",
      priority: "medium",
      labels: ["frontend", "ui"],
      planning: { node_type: "work", group_ids: ["parent"], lane: "build", rank: 2, horizon: "current" },
      dependencies: ["backend"],
      related: ["testing"],
      verification: { commands: ["npm test", "npm run lint"] },
      body: {
        description: "Build UI flows for Feature Alpha on the web client.",
        acceptance: ["Screens implemented", "API integrated", "Accessibility checks pass"],
        verification: ["npm test", "npm run lint", "npm run test:a11y"],
      },
      logs: [
        {
          summary: "Waiting on API responses to stabilize.",
          blockers: ["Backend contract not finalized"],
          created_from: "parent",
          context: ["Design mocks v1.2", "API schema draft"],
        },
      ],
    },
    {
      key: "testing",
      title: "Feature Alpha integration tests",
      status: "todo",
      priority: "medium",
      labels: ["qa"],
      planning: { node_type: "work", group_ids: ["parent"], lane: "verify", rank: 1, horizon: "current" },
      dependencies: ["backend", "frontend"],
      verification: { commands: ["npm test"] },
      body: {
        description: "Add end-to-end coverage for Alpha flows.",
        acceptance: ["E2E happy path", "Error paths covered", "Regression suite green"],
        verification: ["npm test"],
      },
      logs: [
        {
          summary: "Outlined E2E scenarios to automate.",
          next_steps: ["Set up test data fixtures"],
          created_from: "parent",
          context: ["Frontend flow chart", "Backend contract v1"],
        },
      ],
    },
    {
      key: "docs",
      title: "Feature Alpha documentation",
      status: "todo",
      priority: "low",
      labels: ["docs"],
      planning: { node_type: "work", group_ids: ["parent"], lane: "launch", rank: 2, horizon: "next" },
      dependencies: ["testing"],
      verification: { commands: ["npm run lint:docs"] },
      body: {
        description: "Document user guide and API reference for Alpha.",
        acceptance: ["User guide drafted", "API examples updated", "Changelog entry added"],
        verification: ["npm run lint:docs"],
      },
      logs: [
        {
          summary: "Preparing outline; waiting on test results.",
          blockers: ["Integration tests pending"],
          created_from: "parent",
          context: ["Feature overview", "Known limitations"],
        },
      ],
    },
    {
      key: "release",
      title: "Feature Alpha release coordination",
      status: "todo",
      priority: "high",
      labels: ["release"],
      planning: { node_type: "checkpoint", group_ids: ["parent"], lane: "launch", rank: 1, horizon: "current" },
      dependencies: ["testing"],
      blocks: ["bugfix"],
      verification: { commands: ["npx @picoai/tickets validate"] },
      body: {
        description: "Plan release window and rollout steps.",
        acceptance: ["Release checklist approved", "Rollout scheduled", "Comms ready"],
        verification: ["npx @picoai/tickets validate"],
      },
      logs: [
        {
          summary: "Drafted release checklist; waiting on test green.",
          context: ["Release checklist draft", "Waiting on integration test completion"],
          next_steps: ["Book release window"],
        },
      ],
    },
    {
      key: "bugfix",
      title: "Bugfix: address regression found during Alpha",
      status: "canceled",
      priority: "high",
      labels: ["bug", "regression"],
      planning: { node_type: "work", group_ids: ["parent"], lane: "build", rank: 3, horizon: "current" },
      resolution: "dropped",
      dependencies: ["backend"],
      related: ["testing"],
      verification: { commands: ["npm test"] },
      body: {
        description: "Fix regression uncovered in integration tests.",
        acceptance: ["Repro scenario fixed", "Regression test added", "No new failures"],
        verification: ["npm test"],
      },
      logs: [
        {
          summary: "Dropped after mitigation in backend workstream.",
          context: ["Regression repro identified", "Awaiting backend deployment before retry"],
          decisions: ["Folded remediation into backend ticket"],
        },
      ],
    },
  ];

  for (const spec of specs) {
    const ticketId = ids[spec.key];
    const ticketDir = path.join(ticketsDir(), ticketId);
    ensureDir(path.join(ticketDir, "logs"));

    const frontMatter = {
      id: ticketId,
      version: FORMAT_VERSION,
      version_url: FORMAT_VERSION_URL,
      title: spec.title,
      status: spec.status,
      created_at: iso8601(now),
    };

    if (spec.priority) {
      frontMatter.priority = spec.priority;
    }
    if (spec.labels) {
      frontMatter.labels = spec.labels;
    }
    if (spec.assignment) {
      frontMatter.assignment = spec.assignment;
    }
    if (spec.planning) {
      frontMatter.planning = {
        ...spec.planning,
        group_ids: spec.planning.group_ids?.map((value) => ids[value]) ?? spec.planning.group_ids,
        precedes: spec.planning.precedes?.map((value) => ids[value]) ?? spec.planning.precedes,
      };
    }
    if (spec.resolution) {
      frontMatter.resolution = spec.resolution;
    }
    for (const relationshipKey of ["dependencies", "blocks", "related"]) {
      if (spec[relationshipKey]) {
        frontMatter[relationshipKey] = spec[relationshipKey].map((value) => ids[value]);
      }
    }
    if (spec.agent_limits) {
      frontMatter.agent_limits = spec.agent_limits;
    }
    if (spec.verification) {
      frontMatter.verification = spec.verification;
    }

    const bodyLines = [
      "# Ticket",
      "",
      "## Description",
      spec.body.description,
      "",
      "## Acceptance Criteria",
      ...spec.body.acceptance.map((item) => `- [ ] ${item}`),
      "",
      "## Verification",
      ...spec.body.verification.map((item) => `- ${item}`),
      "",
    ];

    writeTicket(path.join(ticketDir, "ticket.md"), frontMatter, bodyLines.join("\n"));

    for (const logSpec of spec.logs ?? []) {
      const runId = newUuidv7();
      const logPath = path.join(ticketDir, "logs", `${runStarted}-${runId}.jsonl`);
      const logEntry = {
        version: FORMAT_VERSION,
        version_url: FORMAT_VERSION_URL,
        ts: iso8601(nowUtc()),
        run_started: runStarted,
        actor_type: "agent",
        actor_id: "tickets-init",
        summary: logSpec.summary,
        event_type: logSpec.event_type ?? "work",
        written_by: "tickets",
      };

      for (const key of [
        "context",
        "claim",
        "decisions",
        "next_steps",
        "blockers",
        "tickets_created",
        "created_from",
      ]) {
        if (!(key in logSpec)) {
          continue;
        }

        if (key === "tickets_created") {
          logEntry[key] = logSpec[key].map((value) => ids[value]);
        } else if (key === "created_from") {
          logEntry[key] = ids[logSpec[key]] ?? logSpec[key];
        } else if (key === "claim") {
          logEntry.claim = {
            ...logSpec.claim,
            claim_id: newUuidv7().toLowerCase(),
            expires_at: iso8601(new Date(now.getTime() + (logSpec.claim.ttl_minutes ?? 60) * 60 * 1000)),
          };
        } else {
          logEntry[key] = logSpec[key];
        }
      }

      appendJsonl(logPath, logEntry);
    }
  }
}

async function cmdInit(options) {
  ensureDir(ticketsDir());
  const root = repoRoot();
  const repoBaseDir = path.join(root, BASE_DIR);
  ensureDir(repoBaseDir);
  const apply = Boolean(options.apply);

  syncTicketsMd(root, apply);
  syncRepoConfig(root);
  syncRepoSkill(root, apply);

  const agentsPath = path.join(root, "AGENTS_EXAMPLE.md");
  const agentsTemplatePath = path.join(".tickets", "spec", "AGENTS_EXAMPLE.md");
  if (apply) {
    applyAgentsMdSection(root, readTemplate(agentsTemplatePath));
  } else {
    writeTemplateFile(agentsPath, agentsTemplatePath, false);
  }

  const versionDir = path.join(repoBaseDir, "version");
  ensureDir(versionDir);

  const currentSpecPath = path.join(versionDir, "20260317-2-tickets-spec.md");
  writeTemplateFile(currentSpecPath, path.join(".tickets", "spec", "version", "20260317-2-tickets-spec.md"), apply);

  const previousCurrentSpecPath = path.join(versionDir, "20260311-tickets-spec.md");
  writeTemplateFile(
    previousCurrentSpecPath,
    path.join(".tickets", "spec", "version", "20260311-tickets-spec.md"),
    apply,
  );

  const previousSpecPath = path.join(versionDir, "20260205-tickets-spec.md");
  writeTemplateFile(previousSpecPath, path.join(".tickets", "spec", "version", "20260205-tickets-spec.md"), apply);

  const proposedPath = path.join(versionDir, "PROPOSED-tickets-spec.md");
  writeTemplateFile(proposedPath, path.join(".tickets", "spec", "version", "PROPOSED-tickets-spec.md"), apply);

  if (options.examples) {
    generateExampleTickets();
  }

  invalidatePlanningIndex();
  process.stdout.write("Initialized.\n");
  return 0;
}

async function cmdNew(options) {
  ensureDir(ticketsDir());
  const profile = loadWorkflowProfile();
  const snapshot = loadPlanningSnapshot({ persist: false });
  const ticketId = newUuidv7().toLowerCase();
  const ticketDir = path.join(ticketsDir(), ticketId);
  ensureDir(path.join(ticketDir, "logs"));
  const groupIds = options.groupIds?.length ? options.groupIds : [];
  const groupTargets = resolveGroupTargets(groupIds, snapshot);

  let lane = options.lane ?? null;
  if (lane === null && groupTargets.length > 0) {
    lane = inferInheritedScalar(groupTargets, "lane", "lane");
  }
  if (lane === null) {
    lane = profile.defaults?.planning?.lane ?? null;
  }

  let horizon = options.horizon ?? null;
  if (horizon === null && groupTargets.length > 0) {
    horizon = inferInheritedScalar(groupTargets, "horizon", "horizon");
  }
  if (horizon === null) {
    horizon = profile.defaults?.planning?.horizon ?? null;
  }

  const planning = {
    node_type: options.nodeType || profile.defaults?.planning?.node_type || "work",
    group_ids: groupIds,
    lane,
    rank: options.rank ?? null,
    horizon,
    precedes: options.precedes?.length ? options.precedes : [],
  };
  if (planning.rank === null && planning.lane) {
    planning.rank = inferNextRank(snapshot, planning);
  }

  const frontMatter = {
    id: ticketId,
    version: FORMAT_VERSION,
    version_url: FORMAT_VERSION_URL,
    title: options.title,
    status: options.status,
    created_at: options.createdAt || iso8601(nowUtc()),
  };

  if (options.priority) {
    frontMatter.priority = options.priority;
  }
  if (options.labels?.length) {
    frontMatter.labels = options.labels;
  }
  if (options.assignmentMode || options.assignmentOwner) {
    frontMatter.assignment = {
      mode: options.assignmentMode,
      owner: options.assignmentOwner,
    };
  }

  for (const [key, value] of [
    ["dependencies", options.dependencies],
    ["blocks", options.blocks],
    ["related", options.related],
  ]) {
    if (value?.length) {
      frontMatter[key] = value;
    }
  }

  const agentLimits = {};
  if (options.iterationTimeboxMinutes) {
    agentLimits.iteration_timebox_minutes = options.iterationTimeboxMinutes;
  }
  if (options.maxIterations) {
    agentLimits.max_iterations = options.maxIterations;
  }
  if (options.maxToolCalls) {
    agentLimits.max_tool_calls = options.maxToolCalls;
  }
  if (options.checkpointEveryMinutes) {
    agentLimits.checkpoint_every_minutes = options.checkpointEveryMinutes;
  }
  if (Object.keys(agentLimits).length > 0) {
    frontMatter.agent_limits = agentLimits;
  }

  if (options.verificationCommands?.length) {
    frontMatter.verification = { commands: options.verificationCommands };
  }
  frontMatter.planning = planning;
  if (options.resolution) {
    frontMatter.resolution = options.resolution;
  }

  const body = [
    "# Ticket",
    "",
    "> Before starting: read `TICKETS.md` (canonical workflow) and confirm you understand how to use this ticketing system.",
    "",
    "## Description",
    "(fill in)",
    "",
    "## Acceptance Criteria",
    "- [ ] Define clear, checkable outcomes.",
    "",
    "## Verification",
    "- (add commands or steps)",
    "",
  ].join("\n");

  writeTicket(path.join(ticketDir, "ticket.md"), frontMatter, body);
  refreshPlanningIndexIfPresent();
  process.stdout.write(`${ticketId}\n`);
  return 0;
}

async function cmdValidate(options) {
  const ticketPaths = collectTicketPaths(options.ticket);
  const allTicketPaths = collectTicketPaths(null);
  const issues = [];

  issues.push(...validateRepoConfig(repoRoot()));

  for (const ticketPath of ticketPaths) {
    const [ticketIssues] = validateTicket(ticketPath, options.allFields);
    issues.push(...ticketIssues);

    const logsDir = path.join(path.dirname(ticketPath), "logs");
    if (!fs.existsSync(logsDir)) {
      continue;
    }

    const logFiles = fs
      .readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(logsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));

    for (const logFile of logFiles) {
      issues.push(...validateRunLog(logFile, false));
    }
  }

  issues.push(...validatePlanningTopology(ticketPaths, allTicketPaths));

  issues.forEach((issue, index) => {
    if (!issue.id) {
      issue.id = `I${String(index + 1).padStart(4, "0")}`;
    }
  });

  if (options.issues) {
    const report = {
      schema_version: 1,
      generated_at: iso8601(nowUtc()),
      tool: "tickets",
      targets: ticketPaths,
      issues,
      repairs: buildRepairsFromIssues(issues, { includeOptional: options.allFields }),
    };

    const content = yaml.stringify(report);
    if (options.output) {
      fs.writeFileSync(path.resolve(repoRoot(), options.output), content);
    } else {
      process.stdout.write(content);
    }
  } else {
    printIssues(issues);
  }

  return hasErrors(issues) ? 1 : 0;
}

async function cmdStatus(options) {
  const ticketPath = resolveTicketPath(options.ticket);
  const [frontMatter, body] = loadTicket(ticketPath);
  const previousStatus = frontMatter.status;
  const actorId = resolveActorId(options.actorId);
  const actorType = resolveActorType(options.actorType, actorId);
  const context = normalizeContextItems(options.context);

  frontMatter.status = options.status;
  writeTicket(ticketPath, frontMatter, body);

  const runId = options.runId || newUuidv7();
  const runStarted = (options.runStarted || isoBasic(nowUtc())).replaceAll(" ", "");
  const entry = {
    version: FORMAT_VERSION,
    version_url: FORMAT_VERSION_URL,
    ts: iso8601(nowUtc()),
    run_started: runStarted,
    actor_type: actorType,
    actor_id: actorId,
    summary:
      previousStatus === options.status
        ? `Status reaffirmed as ${options.status}`
        : `Status changed from ${previousStatus ?? "unknown"} to ${options.status}`,
    event_type: "status",
    written_by: "tickets",
  };
  if (context.length > 0) {
    entry.context = context;
  }

  const logPath = path.join(path.dirname(ticketPath), "logs", `${runStarted}-${runId}.jsonl`);
  appendJsonl(logPath, entry);
  refreshPlanningIndexIfPresent();

  return 0;
}

async function cmdLog(options) {
  const ticketPath = resolveTicketPath(options.ticket);
  const runId = options.runId || newUuidv7();
  const runStarted = (options.runStarted || isoBasic(nowUtc())).replaceAll(" ", "");
  const actorId = resolveActorId(options.actorId);
  const actorType = resolveActorType(options.actorType, actorId);
  const context = normalizeContextItems(options.context);
  if (options.machine && context.length === 0) {
    throw new Error("Machine-written work logs require at least one --context item");
  }

  const entry = {
    version: FORMAT_VERSION,
    version_url: FORMAT_VERSION_URL,
    ts: iso8601(nowUtc()),
    run_started: runStarted,
    actor_type: actorType,
    actor_id: actorId,
    summary: options.summary,
    event_type: "work",
  };
  if (context.length > 0) {
    entry.context = context;
  }

  if (options.machine) {
    entry.written_by = "tickets";
  }
  if (options.changes?.length) {
    entry.changes = { files: options.changes };
  }
  if (options.decisions?.length) {
    entry.decisions = options.decisions;
  }
  if (options.nextSteps?.length) {
    entry.next_steps = options.nextSteps;
  }
  if (options.blockers?.length) {
    entry.blockers = options.blockers;
  }
  if (options.ticketsCreated?.length) {
    entry.tickets_created = options.ticketsCreated;
  }
  if (options.createdFrom) {
    entry.created_from = options.createdFrom;
  }
  if (options.verificationCommands?.length || options.verificationResults) {
    entry.verification = {
      commands: options.verificationCommands || [],
      results: options.verificationResults || "",
    };
  }

  const logPath = path.join(path.dirname(ticketPath), "logs", `${runStarted}-${runId}.jsonl`);
  appendJsonl(logPath, entry);
  refreshPlanningIndexIfPresent();
  return 0;
}

function renderTable(headers, rows) {
  process.stdout.write(`${headers.join(" | ")}\n`);
  for (const row of rows) {
    process.stdout.write(`${headers.map((key) => String(row[key] ?? "")).join(" | ")}\n`);
  }
}

async function cmdList(options) {
  const snapshot = loadPlanningSnapshot();
  const rows = listTickets(
    snapshot,
    {
      status: options.status,
      priority: options.priority,
      mode: options.mode,
      owner: options.owner,
      label: options.label,
      text: options.text,
      nodeType: options.nodeType,
      group: options.group,
      lane: options.lane,
      horizon: options.horizon,
      claimed: Boolean(options.claimed),
      claimedBy: options.claimedBy,
      ready: Boolean(options.ready),
    },
    {
      sortBy: options.sort,
      reverse: Boolean(options.reverse),
    },
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }

  if (rows.length === 0) {
    process.stdout.write("No tickets.\n");
    return 0;
  }

  const headers = [
    "id",
    "title",
    "status",
    "priority",
    "node_type",
    "lane",
    "rank",
    "horizon",
    "ready",
    "claim",
    "owner",
    "last_updated",
  ];
  renderTable(headers, rows.map((row) => ({ ...row, claim: row.claim_summary })));

  return 0;
}

async function cmdPlan(options) {
  const snapshot = loadPlanningSnapshot();
  const summary = buildPlanSummary(snapshot, {
    group: options.group ?? options.root ?? null,
    horizon: options.horizon ?? null,
  });

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  const itemHeaders = [
    "id",
    "title",
    "status",
    "priority",
    "node_type",
    "lane",
    "rank",
    "horizon",
    "claim",
    "owner",
  ];
  const groupHeaders = ["id", "title", "node_type", "lane", "rank", "horizon", "rollup_summary"];

  const activeRows = summary.active.map((row) => ({ ...row }));
  const blockedRows = summary.blocked.map((row) => ({
    ...row,
    blocked_by: JSON.stringify(row.blocked_by),
  }));
  const groupRows = summary.groups.map((group) => {
    const rollup = group.rollup ?? {};
    return {
      ...group,
      rollup_summary: `${rollup.done_completed ?? 0}/${rollup.active_leaf ?? 0} complete | merged=${rollup.merged ?? 0} | dropped=${rollup.dropped ?? 0}`,
    };
  });

  process.stdout.write("Ready\n");
  renderTable(itemHeaders, summary.ready.map((row) => ({ ...row, claim: row.claim_summary })));
  process.stdout.write("\nIn Progress\n");
  renderTable(itemHeaders, activeRows.map((row) => ({ ...row, claim: row.claim_summary })));
  process.stdout.write("\nBlocked\n");
  renderTable([...itemHeaders, "blocked_by"], blockedRows.map((row) => ({ ...row, claim: row.claim_summary })));
  process.stdout.write("\nGroups / Checkpoints\n");
  renderTable(groupHeaders, groupRows);

  return 0;
}

async function cmdClaim(options) {
  const ticketPath = resolveTicketPath(options.ticket);
  const logsDir = path.join(path.dirname(ticketPath), "logs");
  ensureDir(logsDir);
  const profile = loadWorkflowProfile();

  const actorId = resolveActorId(options.actorId);
  const actorType = resolveActorType(options.actorType, actorId);
  const events = loadClaimEvents(logsDir);
  const activeClaim = deriveActiveClaim(events, nowUtc());
  const runId = options.runId || newUuidv7();
  const runStarted = (options.runStarted || isoBasic(nowUtc())).replaceAll(" ", "");
  const ttlMinutes = options.ttlMinutes || profile.defaults?.claims?.ttl_minutes || DEFAULT_CLAIM_TTL_MINUTES;
  const now = nowUtc();

  let action;
  let summary;
  let claimId = newUuidv7().toLowerCase();
  let supersedesClaimId = null;

  if (options.release) {
    if (!activeClaim) {
      process.stdout.write("No active claim.\n");
      return 1;
    }
    if (activeClaim.holder_id !== actorId && !options.force) {
      process.stdout.write(`Ticket is claimed by ${activeClaim.holder_id} until ${activeClaim.expires_at}.\n`);
      return 1;
    }
    if (activeClaim.holder_id !== actorId && options.force && !options.reason) {
      throw new Error("Forced claim release requires --reason");
    }
    action = "release";
    claimId = activeClaim.claim_id;
    summary = `Released claim ${claimId}`;
  } else if (activeClaim && activeClaim.holder_id === actorId) {
    action = "renew";
    claimId = activeClaim.claim_id;
    summary = `Renewed claim ${claimId}`;
  } else if (activeClaim && activeClaim.holder_id !== actorId) {
    if (!options.force) {
      process.stdout.write(`Ticket is claimed by ${activeClaim.holder_id} until ${activeClaim.expires_at}.\n`);
      return 1;
    }
    if (!options.reason) {
      throw new Error("Forced claim override requires --reason");
    }
    action = "override";
    supersedesClaimId = activeClaim.claim_id;
    summary = `Overrode claim ${activeClaim.claim_id}`;
  } else {
    action = "acquire";
    summary = `Acquired claim ${claimId}`;
  }

  const entry = {
    version: FORMAT_VERSION,
    version_url: FORMAT_VERSION_URL,
    ts: iso8601(now),
    run_started: runStarted,
    actor_type: actorType,
    actor_id: actorId,
    summary,
    event_type: "claim",
    written_by: "tickets",
    claim: {
      action,
      claim_id: claimId,
      holder_id: actorId,
      holder_type: actorType,
      reason: options.reason ?? "",
      supersedes_claim_id: supersedesClaimId,
    },
  };

  if (action !== "release") {
    entry.claim.ttl_minutes = ttlMinutes;
    entry.claim.expires_at = iso8601(new Date(now.getTime() + ttlMinutes * 60 * 1000));
  }

  appendJsonl(path.join(logsDir, `${runStarted}-${runId}.jsonl`), entry);
  refreshPlanningIndexIfPresent();
  process.stdout.write(`${summary}\n`);
  return 0;
}

async function cmdRepair(options) {
  const nonInteractive = options.nonInteractive;

  if (options.issuesFile) {
    const data = loadIssuesFile(path.resolve(repoRoot(), options.issuesFile));
    const repairs = Array.isArray(data.repairs) ? data.repairs : [];
    const changes = options.interactive
      ? await runInteractive(repairs, { includeOptional: options.allFields })
      : await applyRepairs(repairs, {
          nonInteractive,
          includeOptional: options.allFields,
        });

    for (const change of changes) {
      process.stdout.write(`${change}\n`);
    }

    return changes.length > 0 ? 0 : 1;
  }

  let targets;
  if (options.ticket) {
    targets = [resolveTicketPath(options.ticket)];
  } else {
    targets = collectTicketPaths(null);
  }

  const repairs = [];
  for (const ticketPath of targets) {
    const [issues] = validateTicket(ticketPath, options.allFields);
    repairs.push(
      ...buildRepairsFromIssues(issues, {
        includeOptional: options.allFields,
        autoEnableSafe: !options.interactive,
      }),
    );

    const logsDir = path.join(path.dirname(ticketPath), "logs");
    if (!fs.existsSync(logsDir)) {
      continue;
    }
    const logFiles = fs
      .readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(logsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
    for (const logFile of logFiles) {
      repairs.push(
        ...buildRepairsFromIssues(validateRunLog(logFile, false), {
          includeOptional: options.allFields,
          autoEnableSafe: !options.interactive,
        }),
      );
    }
  }

  const changes = options.interactive
    ? await runInteractive(repairs, { includeOptional: options.allFields })
    : await applyRepairs(repairs, {
        nonInteractive,
        includeOptional: options.allFields,
      });

  for (const change of changes) {
    process.stdout.write(`${change}\n`);
  }

  return changes.length > 0 ? 0 : 1;
}

async function cmdGraph(options) {
  const snapshot = loadPlanningSnapshot();
  const graph = buildGraphData(snapshot, {
    ticket: options.ticket,
    view: options.view,
    includeRelated: options.related,
  });
  if (graph.nodes.length === 0) {
    process.stdout.write("No tickets found.\n");
    return 1;
  }

  const graphDir = path.join(repoRoot(), ".tickets", "graph");
  ensureDir(graphDir);

  const timestamp = isoBasic(nowUtc());
  const base = options.ticket
    ? `${options.view}_for_${graph.root_id || "subset"}`
    : options.view;
  const ext = { mermaid: "md", dot: "dot", json: "json" }[options.format];
  const outPath = options.output
    ? path.resolve(repoRoot(), options.output)
    : path.join(graphDir, `${timestamp}_${base}.${ext}`);

  if (options.format === "json") {
    const json = renderJson(graph, options.related);
    fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);
  } else if (options.format === "dot") {
    fs.writeFileSync(outPath, renderDot(graph, options.related));
  } else {
    fs.writeFileSync(outPath, renderMermaid(graph, options.related, timestamp, options.view));
  }

  process.stdout.write(`${outPath}\n`);
  return 0;
}

export async function run(argv = process.argv.slice(2)) {
  const program = new Command();
  program.name("tickets").description("Repo-native ticketing CLI");

  program
    .command("init")
    .description("Initialize tickets structure")
    .option("--examples", "Generate example tickets and logs")
    .option(
      "--apply",
      "Update managed TICKETS.md + AGENTS.md Ticketing Workflow block; skip AGENTS_EXAMPLE.md output",
    )
    .action(async (options) => {
      process.exitCode = await cmdInit(options);
    });

  program
    .command("new")
    .description("Create new ticket")
    .requiredOption("--title <title>")
    .option("--status <status>", "Ticket status", "todo")
    .option("--priority <priority>")
    .option("--label <label>", "Label", collectOption, [])
    .option("--assignment-mode <mode>")
    .option("--assignment-owner <owner>")
    .option("--dependency <ticketId>", "Dependency ticket id", collectOption, [])
    .option("--block <ticketId>", "Blocked ticket id", collectOption, [])
    .option("--related <ticketId>", "Related ticket id", collectOption, [])
    .option("--iteration-timebox-minutes <minutes>")
    .option("--max-iterations <count>")
    .option("--max-tool-calls <count>")
    .option("--checkpoint-every-minutes <minutes>")
    .option("--verification-command <command>", "Verification command", collectOption, [])
    .option("--created-at <timestamp>")
    .option("--node-type <nodeType>")
    .option("--group-id <groupId>", "Group membership ticket id", collectOption, [])
    .option("--lane <lane>")
    .option("--rank <rank>")
    .option("--horizon <horizon>")
    .option("--precedes <ticketId>", "Sequence successor ticket id", collectOption, [])
    .option("--resolution <resolution>")
    .action(async (options) => {
      if (!STATUS_VALUES.includes(options.status)) {
        throw new Error(`Invalid --status. Use one of: ${STATUS_VALUES.join(", ")}`);
      }
      if (options.priority && !PRIORITY_VALUES.includes(options.priority)) {
        throw new Error(`Invalid --priority. Use one of: ${PRIORITY_VALUES.join(", ")}`);
      }
      if (options.assignmentMode && !ASSIGNMENT_MODE_VALUES.includes(options.assignmentMode)) {
        throw new Error(
          `Invalid --assignment-mode. Use one of: ${ASSIGNMENT_MODE_VALUES.join(", ")}`,
        );
      }
      if (options.nodeType && !PLANNING_NODE_TYPES.includes(options.nodeType)) {
        throw new Error(`Invalid --node-type. Use one of: ${PLANNING_NODE_TYPES.join(", ")}`);
      }
      if (options.resolution && !RESOLUTION_VALUES.includes(options.resolution)) {
        throw new Error(`Invalid --resolution. Use one of: ${RESOLUTION_VALUES.join(", ")}`);
      }
      if (options.rank) {
        const rank = Number.parseInt(options.rank, 10);
        if (!Number.isInteger(rank) || rank <= 0) {
          throw new Error("Invalid --rank. Use a positive integer");
        }
      }
      if (options.resolution && !["done", "canceled"].includes(options.status)) {
        throw new Error("Resolution requires terminal status done or canceled");
      }
      process.exitCode = await cmdNew({
        title: options.title,
        status: options.status,
        priority: options.priority,
        labels: options.label,
        assignmentMode: options.assignmentMode,
        assignmentOwner: options.assignmentOwner,
        dependencies: options.dependency,
        blocks: options.block,
        related: options.related,
        iterationTimeboxMinutes: options.iterationTimeboxMinutes
          ? Number.parseInt(options.iterationTimeboxMinutes, 10)
          : undefined,
        maxIterations: options.maxIterations ? Number.parseInt(options.maxIterations, 10) : undefined,
        maxToolCalls: options.maxToolCalls ? Number.parseInt(options.maxToolCalls, 10) : undefined,
        checkpointEveryMinutes: options.checkpointEveryMinutes
          ? Number.parseInt(options.checkpointEveryMinutes, 10)
          : undefined,
        verificationCommands: options.verificationCommand,
        createdAt: options.createdAt,
        nodeType: options.nodeType,
        groupIds: options.groupId,
        lane: options.lane,
        rank: options.rank ? Number.parseInt(options.rank, 10) : null,
        horizon: options.horizon,
        precedes: options.precedes,
        resolution: options.resolution,
      });
    });

  program
    .command("validate")
    .description("Validate tickets")
    .option("--ticket <ticket>")
    .option("--issues", "Output machine-readable issues/repairs")
    .option("--output <file>", "Output path for issues report")
    .option("--all-fields", "Validate optional front-matter fields too")
    .action(async (options) => {
      process.exitCode = await cmdValidate({
        ticket: options.ticket,
        issues: Boolean(options.issues),
        output: options.output,
        allFields: Boolean(options.allFields),
      });
    });

  program
    .command("status")
    .description("Update ticket status")
    .requiredOption("--ticket <ticket>")
    .requiredOption("--status <status>")
    .option("--actor-type <actorType>")
    .option("--actor-id <actorId>")
    .option("--context <items...>")
    .option("--run-id <runId>")
    .option("--run-started <runStarted>")
    .action(async (options) => {
      if (!STATUS_VALUES.includes(options.status)) {
        throw new Error(`Invalid --status. Use one of: ${STATUS_VALUES.join(", ")}`);
      }
      if (options.actorType && !isValidActorType(options.actorType)) {
        throw new Error("Invalid --actor-type. Use one of: human, agent");
      }
      process.exitCode = await cmdStatus({
        ticket: options.ticket,
        status: options.status,
        actorType: options.actorType,
        actorId: options.actorId,
        context: options.context,
        runId: options.runId,
        runStarted: options.runStarted,
      });
    });

  program
    .command("log")
    .description("Append a run log entry")
    .requiredOption("--ticket <ticket>")
    .option("--run-id <runId>")
    .option("--run-started <runStarted>")
    .option("--actor-type <actorType>")
    .option("--actor-id <actorId>")
    .requiredOption("--summary <summary>")
    .option("--machine")
    .option("--changes <files...>")
    .option("--decisions <decisions...>")
    .option("--next-steps <nextSteps...>")
    .option("--blockers <blockers...>")
    .option("--tickets-created <tickets...>")
    .option("--created-from <ticketId>")
    .option("--context <items...>")
    .option("--verification-commands <commands...>")
    .option("--verification-results <results>")
    .action(async (options) => {
      if (options.actorType && !isValidActorType(options.actorType)) {
        throw new Error("Invalid --actor-type. Use one of: human, agent");
      }
      process.exitCode = await cmdLog({
        ticket: options.ticket,
        runId: options.runId,
        runStarted: options.runStarted,
        actorType: options.actorType,
        actorId: options.actorId,
        summary: options.summary,
        machine: Boolean(options.machine),
        changes: options.changes,
        decisions: options.decisions,
        nextSteps: options.nextSteps,
        blockers: options.blockers,
        ticketsCreated: options.ticketsCreated,
        createdFrom: options.createdFrom,
        context: options.context,
        verificationCommands: options.verificationCommands,
        verificationResults: options.verificationResults,
      });
    });

  program
    .command("list")
    .description("List tickets")
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--mode <mode>")
    .option("--owner <owner>")
    .option("--label <label>")
    .option("--text <text>")
    .option("--node-type <nodeType>")
    .option("--group <ticketId>")
    .option("--lane <lane>")
    .option("--horizon <horizon>")
    .option("--claimed", "Only show claimed tickets")
    .option("--claimed-by <actorId>")
    .option("--ready", "Only show ready tickets")
    .option("--sort <sort>", "ready | priority | lane | rank | updated | title")
    .option("--reverse", "Reverse the sort order")
    .option("--json", "JSON output")
    .action(async (options) => {
      if (options.sort && !LIST_SORT_VALUES.includes(options.sort)) {
        throw new Error(`Invalid --sort. Use one of: ${LIST_SORT_VALUES.join(", ")}`);
      }
      process.exitCode = await cmdList(options);
    });

  program
    .command("plan")
    .description("Summarize portfolio rollups and ready work")
    .option("--root <ticket>")
    .option("--group <ticket>")
    .option("--horizon <horizon>")
    .option("--format <format>", "table | json", "table")
    .action(async (options) => {
      if (!["table", "json"].includes(options.format)) {
        throw new Error("Invalid --format. Use one of: table, json");
      }
      process.exitCode = await cmdPlan(options);
    });

  program
    .command("repair")
    .description("Repair tickets")
    .option("--ticket <ticket>")
    .option("--all", "Repair all tickets")
    .option("--issues-file <file>")
    .option("--interactive", "Interactive mode")
    .option("--non-interactive", "Fail if unresolved values are required")
    .option("--all-fields", "Repair optional front-matter fields too")
    .action(async (options) => {
      process.exitCode = await cmdRepair({
        ticket: options.ticket,
        all: Boolean(options.all),
        issuesFile: options.issuesFile,
        interactive: Boolean(options.interactive),
        nonInteractive: Boolean(options.nonInteractive),
        allFields: Boolean(options.allFields),
      });
    });

  program
    .command("graph")
    .description("Ticket graph")
    .option("--ticket <ticket>")
    .option("--format <format>", "mermaid | dot | json", "mermaid")
    .option("--view <view>", "dependency | sequence | portfolio | all", "dependency")
    .option("--output <file>")
    .option("--related", "Include related edges")
    .option("--no-related", "Exclude related edges")
    .action(async (options) => {
      if (!["mermaid", "dot", "json"].includes(options.format)) {
        throw new Error("Invalid --format. Use one of: mermaid, dot, json");
      }
      if (!GRAPH_VIEW_VALUES.includes(options.view)) {
        throw new Error(`Invalid --view. Use one of: ${GRAPH_VIEW_VALUES.join(", ")}`);
      }
      process.exitCode = await cmdGraph({
        ticket: options.ticket,
        format: options.format,
        view: options.view,
        output: options.output,
        related: options.related,
      });
    });

  program
    .command("claim")
    .description("Acquire, renew, release, or override an advisory ticket claim")
    .requiredOption("--ticket <ticket>")
    .option("--actor-type <actorType>")
    .option("--actor-id <actorId>")
    .option("--run-id <runId>")
    .option("--run-started <runStarted>")
    .option("--ttl-minutes <minutes>")
    .option("--release", "Release the active claim")
    .option("--force", "Override an active claim held by another actor")
    .option("--reason <reason>")
    .action(async (options) => {
      if (options.actorType && !isValidActorType(options.actorType)) {
        throw new Error("Invalid --actor-type. Use one of: human, agent");
      }
      if (options.ttlMinutes) {
        const ttl = Number.parseInt(options.ttlMinutes, 10);
        if (!Number.isInteger(ttl) || ttl <= 0) {
          throw new Error("Invalid --ttl-minutes. Use a positive integer");
        }
      }
      process.exitCode = await cmdClaim({
        ticket: options.ticket,
        actorType: options.actorType,
        actorId: options.actorId,
        runId: options.runId,
        runStarted: options.runStarted,
        ttlMinutes: options.ttlMinutes ? Number.parseInt(options.ttlMinutes, 10) : undefined,
        release: Boolean(options.release),
        force: Boolean(options.force),
        reason: options.reason,
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    process.exitCode = 2;
  }

  return process.exitCode ?? 0;
}
