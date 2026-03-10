import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import yaml from "yaml";

import {
  ASSIGNMENT_MODE_VALUES,
  BASE_DIR,
  FORMAT_VERSION,
  FORMAT_VERSION_URL,
  PRIORITY_VALUES,
  STATUS_VALUES,
} from "./lib/constants.js";
import { listTickets } from "./lib/listing.js";
import { applyRepairs, loadIssuesFile, runInteractive } from "./lib/repair.js";
import { collectTicketPaths, validateRunLog, validateTicket } from "./lib/validation.js";
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

function printIssues(issues) {
  for (const issue of issues) {
    const location = issue.ticket_path ?? issue.log ?? "";
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
    if (!ticketPath) {
      continue;
    }

    const key = `${code}:${ticketPath}`;
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
      ticket_path: ticketPath,
    };

    if (code === "MISSING_SECTION") {
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

function loadNodeById(ticketId) {
  const ticketPath = path.join(ticketsDir(), ticketId, "ticket.md");
  if (fs.existsSync(ticketPath)) {
    try {
      const [frontMatter] = loadTicket(ticketPath);
      return {
        id: ticketId,
        title: frontMatter.title ?? ticketId,
        status: frontMatter.status ?? "",
        priority: frontMatter.priority,
        owner: frontMatter.assignment?.owner,
        mode: frontMatter.assignment?.mode,
        path: ticketPath,
      };
    } catch {
      // ignore
    }
  }

  return {
    id: ticketId,
    title: ticketId,
    status: "",
    path: `/.tickets/${ticketId}/ticket.md`,
  };
}

function loadTicketGraph(ticketRef) {
  const nodes = new Map();
  const edges = [];
  const paths = collectTicketPaths(ticketRef);
  let rootId = null;

  for (const ticketPath of paths) {
    const [frontMatter] = loadTicket(ticketPath);
    const ticketId = frontMatter.id;
    if (!ticketId) {
      continue;
    }

    if (ticketRef && !rootId) {
      rootId = ticketId;
    }

    nodes.set(ticketId, {
      id: ticketId,
      title: frontMatter.title ?? "",
      status: frontMatter.status ?? "",
      priority: frontMatter.priority,
      owner: frontMatter.assignment?.owner,
      mode: frontMatter.assignment?.mode,
      path: ticketPath,
    });

    for (const dependency of frontMatter.dependencies ?? []) {
      if (!nodes.has(dependency)) {
        nodes.set(dependency, loadNodeById(dependency));
      }
      edges.push({ type: "dependency", from: dependency, to: ticketId });
    }

    for (const blocked of frontMatter.blocks ?? []) {
      if (!nodes.has(blocked)) {
        nodes.set(blocked, loadNodeById(blocked));
      }
      edges.push({ type: "blocks", from: ticketId, to: blocked });
    }

    for (const related of frontMatter.related ?? []) {
      if (!nodes.has(related)) {
        nodes.set(related, loadNodeById(related));
      }
      edges.push({ type: "related", from: ticketId, to: related });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    root_id: rootId,
  };
}

function renderMermaid(graph, includeRelated, timestamp) {
  const statusClasses = {
    todo: "fill:#ddd,stroke:#999",
    doing: "fill:#d0e7ff,stroke:#3b82f6",
    blocked: "fill:#ffe4e6,stroke:#ef4444",
    done: "fill:#dcfce7,stroke:#22c55e",
    canceled: "fill:#f3f4f6,stroke:#111827,color:#374151",
  };

  const lines = [
    "# Ticket dependency graph",
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
    const label = `${title}\\n(${node.id})`;
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
    lines.push(`  ${source} --> ${target}`);
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
    const label = `${node.title || node.id}\\n(${node.id})\\n${status}`;
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
    const style = edge.type === "related" ? "dashed" : "solid";
    lines.push(`  ${source} -> ${target} [style=${style}];`);
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
      href: `/.tickets/${node.id}/ticket.md`,
    })),
  };
}

const AGENTS_SECTION_START = "<!-- @picoai/tickets:agents:start -->";
const AGENTS_SECTION_END = "<!-- @picoai/tickets:agents:end -->";
const TICKETS_SECTION_START = "<!-- @picoai/tickets:tickets-md:start -->";
const TICKETS_SECTION_END = "<!-- @picoai/tickets:tickets-md:end -->";
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

function collectLevel2Headings(content) {
  const headings = new Set();
  const normalized = normalizeContent(content);
  for (const match of normalized.matchAll(/^##\s+(.+)$/gm)) {
    headings.add(match[1].trim().toLowerCase());
  }
  return headings;
}

function extractLevel2Sections(content) {
  const lines = normalizeContent(content).split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) {
        sections.push({
          title: current.title,
          content: current.lines.join("\n").trimEnd(),
        });
      }
      current = {
        title: line.slice(3).trim(),
        lines: [line],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push({
      title: current.title,
      content: current.lines.join("\n").trimEnd(),
    });
  }

  return sections;
}

function upsertTicketsMdManagedSection(existingContent, templateContent) {
  const baseContent = stripManagedSection(existingContent, TICKETS_SECTION_START, TICKETS_SECTION_END).trimEnd();
  const headings = collectLevel2Headings(baseContent);
  const missingSections = extractLevel2Sections(templateContent).filter(
    (section) => !headings.has(section.title.toLowerCase()),
  );

  const lines = [
    TICKETS_SECTION_START,
    "## Managed TICKETS.md Additions",
    "",
    `- applied_at: ${iso8601(nowUtc())}`,
    `- written_by: @picoai/tickets@${TOOL_VERSION}`,
    `- spec_version: ${FORMAT_VERSION}`,
    `- version_url: ${FORMAT_VERSION_URL}`,
    "",
    "### Added template sections",
    "",
  ];

  if (missingSections.length === 0) {
    lines.push("- None (all template sections already exist in the base document).");
  } else {
    for (const section of missingSections) {
      lines.push(section.content, "");
    }
  }

  lines.push(TICKETS_SECTION_END);
  const managedSection = lines.join("\n").trimEnd();
  if (!baseContent) {
    return `${managedSection}\n`;
  }
  return `${baseContent}\n\n${managedSection}\n`;
}

function syncTicketsMd(root, apply) {
  const ticketsDocPath = path.join(root, "TICKETS.md");
  const templateContent = readTemplate(path.join(".tickets", "spec", "TICKETS.md"));
  const exists = fs.existsSync(ticketsDocPath);

  if (!exists) {
    fs.writeFileSync(ticketsDocPath, templateContent);
  }

  if (!exists || apply) {
    const existing = fs.readFileSync(ticketsDocPath, "utf8");
    const next = upsertTicketsMdManagedSection(existing, templateContent);
    if (next !== existing) {
      fs.writeFileSync(ticketsDocPath, next);
    }
  }
}

function upsertAgentsSection(existingContent, templateContent) {
  const normalizedExisting = normalizeContent(existingContent);
  const section = `${AGENTS_SECTION_START}\n${templateContent.trimEnd()}\n${AGENTS_SECTION_END}`;
  const startIndex = normalizedExisting.indexOf(AGENTS_SECTION_START);
  const endIndex = normalizedExisting.indexOf(AGENTS_SECTION_END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = normalizedExisting.slice(0, startIndex).trimEnd();
    const after = normalizedExisting.slice(endIndex + AGENTS_SECTION_END.length).trimStart();
    return `${before}\n\n${section}${after ? `\n\n${after}` : ""}\n`;
  }

  if (!normalizedExisting.trim()) {
    return `${section}\n`;
  }

  return `${normalizedExisting.trimEnd()}\n\n${section}\n`;
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
          context_carried_over: ["Acceptance criteria from parent", "Release target"],
        },
      ],
    },
    {
      key: "frontend",
      title: "Feature Alpha frontend UI",
      status: "todo",
      priority: "medium",
      labels: ["frontend", "ui"],
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
          context_carried_over: ["Design mocks v1.2", "API schema draft"],
        },
      ],
    },
    {
      key: "testing",
      title: "Feature Alpha integration tests",
      status: "todo",
      priority: "medium",
      labels: ["qa"],
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
          context_carried_over: ["Frontend flow chart", "Backend contract v1"],
        },
      ],
    },
    {
      key: "docs",
      title: "Feature Alpha documentation",
      status: "todo",
      priority: "low",
      labels: ["docs"],
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
          context_carried_over: ["Feature overview", "Known limitations"],
        },
      ],
    },
    {
      key: "release",
      title: "Feature Alpha release coordination",
      status: "todo",
      priority: "high",
      labels: ["release"],
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
          next_steps: ["Book release window"],
        },
      ],
    },
    {
      key: "bugfix",
      title: "Bugfix: address regression found during Alpha",
      status: "blocked",
      priority: "high",
      labels: ["bug", "regression"],
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
          summary: "Blocked until backend fix lands.",
          blockers: ["Awaiting backend deployment"],
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
        written_by: "tickets",
      };

      for (const key of [
        "decisions",
        "next_steps",
        "blockers",
        "tickets_created",
        "created_from",
        "context_carried_over",
      ]) {
        if (!(key in logSpec)) {
          continue;
        }

        if (key === "tickets_created") {
          logEntry[key] = logSpec[key].map((value) => ids[value]);
        } else if (key === "created_from") {
          logEntry[key] = ids[logSpec[key]] ?? logSpec[key];
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

  const agentsPath = path.join(root, "AGENTS_EXAMPLE.md");
  const agentsTemplatePath = path.join(".tickets", "spec", "AGENTS_EXAMPLE.md");
  if (apply) {
    applyAgentsMdSection(root, readTemplate(agentsTemplatePath));
  } else {
    writeTemplateFile(agentsPath, agentsTemplatePath, false);
  }

  const versionDir = path.join(repoBaseDir, "version");
  ensureDir(versionDir);

  const specPath = path.join(versionDir, "20260205-tickets-spec.md");
  writeTemplateFile(specPath, path.join(".tickets", "spec", "version", "20260205-tickets-spec.md"), apply);

  const proposedPath = path.join(versionDir, "PROPOSED-tickets-spec.md");
  writeTemplateFile(proposedPath, path.join(".tickets", "spec", "version", "PROPOSED-tickets-spec.md"), apply);

  if (options.examples) {
    generateExampleTickets();
  }

  process.stdout.write("Initialized.\n");
  return 0;
}

async function cmdNew(options) {
  ensureDir(ticketsDir());
  const ticketId = newUuidv7().toLowerCase();
  const ticketDir = path.join(ticketsDir(), ticketId);
  ensureDir(path.join(ticketDir, "logs"));

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
  process.stdout.write(`${ticketId}\n`);
  return 0;
}

async function cmdValidate(options) {
  const ticketPaths = collectTicketPaths(options.ticket);
  const issues = [];

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

  frontMatter.status = options.status;
  writeTicket(ticketPath, frontMatter, body);

  if (options.log) {
    const runId = options.runId || newUuidv7();
    const runStarted = (options.runStarted || isoBasic(nowUtc())).replaceAll(" ", "");
    const entry = {
      version: FORMAT_VERSION,
      version_url: FORMAT_VERSION_URL,
      ts: iso8601(nowUtc()),
      run_started: runStarted,
      actor_type: "human",
      actor_id: "status-change",
      summary: `Status set to ${options.status}`,
      written_by: "tickets",
    };

    const logPath = path.join(path.dirname(ticketPath), "logs", `${runStarted}-${runId}.jsonl`);
    appendJsonl(logPath, entry);
  }

  return 0;
}

async function cmdLog(options) {
  const ticketPath = resolveTicketPath(options.ticket);
  const runId = options.runId || newUuidv7();
  const runStarted = (options.runStarted || isoBasic(nowUtc())).replaceAll(" ", "");

  const entry = {
    version: FORMAT_VERSION,
    version_url: FORMAT_VERSION_URL,
    ts: iso8601(nowUtc()),
    run_started: runStarted,
    actor_type: options.actorType,
    actor_id: options.actorId,
    summary: options.summary,
  };

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
  if (options.contextCarriedOver?.length) {
    entry.context_carried_over = options.contextCarriedOver;
  }
  if (options.verificationCommands?.length || options.verificationResults) {
    entry.verification = {
      commands: options.verificationCommands || [],
      results: options.verificationResults || "",
    };
  }

  const logPath = path.join(path.dirname(ticketPath), "logs", `${runStarted}-${runId}.jsonl`);
  appendJsonl(logPath, entry);
  return 0;
}

async function cmdList(options) {
  const rows = listTickets({
    status: options.status,
    priority: options.priority,
    mode: options.mode,
    owner: options.owner,
    label: options.label,
    text: options.text,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }

  if (rows.length === 0) {
    process.stdout.write("No tickets.\n");
    return 0;
  }

  const headers = ["id", "title", "status", "priority", "owner", "mode", "last_updated"];
  process.stdout.write(`${headers.join(" | ")}\n`);
  for (const row of rows) {
    process.stdout.write(`${headers.map((key) => String(row[key] ?? "")).join(" | ")}\n`);
  }

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
  const graph = loadTicketGraph(options.ticket);
  if (graph.nodes.length === 0) {
    process.stdout.write("No tickets found.\n");
    return 1;
  }

  const graphDir = path.join(repoRoot(), ".tickets", "graph");
  ensureDir(graphDir);

  const timestamp = isoBasic(nowUtc());
  const base = options.ticket
    ? `dependencies_for_${graph.root_id || "subset"}`
    : "dependencies";
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
    fs.writeFileSync(outPath, renderMermaid(graph, options.related, timestamp));
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
    .option("--apply", "Additive TICKETS.md update + AGENTS.md upsert; skip AGENTS_EXAMPLE.md output")
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
    .option("--log", "Write a status-change log entry")
    .option("--run-id <runId>")
    .option("--run-started <runStarted>")
    .action(async (options) => {
      if (!STATUS_VALUES.includes(options.status)) {
        throw new Error(`Invalid --status. Use one of: ${STATUS_VALUES.join(", ")}`);
      }
      process.exitCode = await cmdStatus({
        ticket: options.ticket,
        status: options.status,
        log: Boolean(options.log),
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
    .requiredOption("--actor-type <actorType>")
    .requiredOption("--actor-id <actorId>")
    .requiredOption("--summary <summary>")
    .option("--machine")
    .option("--changes <files...>")
    .option("--decisions <decisions...>")
    .option("--next-steps <nextSteps...>")
    .option("--blockers <blockers...>")
    .option("--tickets-created <tickets...>")
    .option("--created-from <ticketId>")
    .option("--context-carried-over <items...>")
    .option("--verification-commands <commands...>")
    .option("--verification-results <results>")
    .action(async (options) => {
      if (!["human", "agent"].includes(options.actorType)) {
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
        contextCarriedOver: options.contextCarriedOver,
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
    .option("--json", "JSON output")
    .action(async (options) => {
      process.exitCode = await cmdList(options);
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
    .description("Dependency graph")
    .option("--ticket <ticket>")
    .option("--format <format>", "mermaid | dot | json", "mermaid")
    .option("--output <file>")
    .option("--related", "Include related edges")
    .option("--no-related", "Exclude related edges")
    .action(async (options) => {
      if (!["mermaid", "dot", "json"].includes(options.format)) {
        throw new Error("Invalid --format. Use one of: mermaid, dot, json");
      }
      process.exitCode = await cmdGraph({
        ticket: options.ticket,
        format: options.format,
        output: options.output,
        related: options.related,
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
