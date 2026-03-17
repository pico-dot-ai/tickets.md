import fs from "node:fs";
import readline from "node:readline/promises";

import yaml from "yaml";

import {
  FORMAT_VERSION,
  FORMAT_VERSION_URL,
  PRIORITY_VALUES,
} from "./constants.js";
import {
  iso8601,
  loadTicket,
  newUuidv7,
  nowUtc,
  parseIso,
  readJsonl,
  writeTicket,
} from "./util.js";

export function loadIssuesFile(filePath) {
  return yaml.parse(fs.readFileSync(filePath, "utf8")) ?? {};
}

export async function applyRepairs(repairs, options = {}) {
  const includeOptional = options.includeOptional ?? false;
  const nonInteractive = options.nonInteractive ?? false;
  const applied = [];

  for (const repair of repairs) {
    if (repair.optional && !includeOptional) {
      continue;
    }
    if (!repair.enabled) {
      continue;
    }

    const action = repair.action;
    const params = repair.params ?? {};
    const ticketPath = repair.ticket_path;
    const logPath = repair.log_path;

    if (action === "set_front_matter_field") {
      const field = params.field;
      let value = params.value;
      if (value == null && params.generate_uuidv7) {
        value = newUuidv7();
      }
      if (value == null) {
        if (nonInteractive) {
          throw new Error(`Repair needs value for ${field}`);
        }
        throw new Error(`Interactive value required for ${field}`);
      }
      setFrontMatterField(ticketPath, field, value);
      applied.push(`${ticketPath}: set ${field}`);
      continue;
    }

    if (action === "add_sections") {
      addMissingSections(ticketPath);
      applied.push(`${ticketPath}: added missing sections`);
      continue;
    }

    if (action === "normalize_created_at") {
      normalizeCreatedAt(ticketPath);
      applied.push(`${ticketPath}: normalized created_at`);
      continue;
    }

    if (action === "normalize_labels") {
      normalizeLabels(ticketPath);
      applied.push(`${ticketPath}: normalized labels`);
      continue;
    }

    if (action === "set_assignment_owner") {
      setAssignmentOwner(ticketPath, params.value ?? null);
      applied.push(`${ticketPath}: set assignment.owner`);
      continue;
    }

    if (action === "reset_verification_commands") {
      resetVerificationCommands(ticketPath, Array.isArray(params.commands) ? params.commands : []);
      applied.push(`${ticketPath}: reset verification.commands`);
      continue;
    }

    if (action === "normalize_verification_commands") {
      normalizeVerificationCommands(ticketPath);
      applied.push(`${ticketPath}: normalized verification.commands`);
      continue;
    }

    if (action === "set_log_event_type") {
      setLogEventType(logPath);
      applied.push(`${logPath}: set event_type`);
      continue;
    }

    if (action === "normalize_log_context") {
      normalizeLogContext(logPath);
      applied.push(`${logPath}: normalized context`);
      continue;
    }

    if (nonInteractive) {
      throw new Error(`Unsupported repair action ${action}`);
    }
  }

  return applied;
}

export async function runInteractive(repairs, options = {}) {
  const includeOptional = options.includeOptional ?? false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive mode requires a TTY");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prepared = [];

  try {
    for (const repair of repairs) {
      if (repair.optional && !includeOptional) {
        continue;
      }

      const [description, suggested] = describeRepair(repair);
      process.stdout.write(`\nRepair ${repair.id}: ${description}\n`);
      const applyChoice = await promptYesNo(rl, "Apply this repair?", true);
      if (!applyChoice) {
        continue;
      }

      repair.enabled = true;
      const action = repair.action;
      const params = repair.params ?? {};

      if (action === "set_front_matter_field") {
        params.value = await promptValueForField(rl, params.field, repair.ticket_path, suggested);
      } else if (action === "set_assignment_owner") {
        params.value = await promptValueForField(rl, "assignment.owner", repair.ticket_path, suggested);
      } else if (action === "reset_verification_commands") {
        params.commands = await promptCommands(rl, Array.isArray(suggested) ? suggested : []);
      }

      repair.params = params;
      prepared.push(repair);
    }
  } finally {
    rl.close();
  }

  return applyRepairs(prepared, { nonInteractive: true, includeOptional });
}

function describeRepair(repair) {
  const action = repair.action;
  const field = repair.params?.field;
  const ticketPath = repair.ticket_path ?? "";
  const logPath = repair.log_path ?? "";
  const value = repair.params?.value;

  if (action === "add_sections") {
    return [`Add missing required sections to ${ticketPath}.`, null];
  }
  if (action === "normalize_created_at") {
    return [`Normalize created_at to ISO8601 UTC in ${ticketPath}.`, iso8601(nowUtc())];
  }
  if (action === "set_front_matter_field") {
    if (field === "id") {
      return ["Set ticket id to a valid UUIDv7 (used to identify the ticket).", newUuidv7()];
    }
    if (field === "version") {
      return [`Set format version (integer, current ${FORMAT_VERSION}).`, FORMAT_VERSION];
    }
    if (field === "version_url") {
      return ["Set version_url (path to the format definition for this version).", FORMAT_VERSION_URL];
    }
    if (field === "priority") {
      return ["Set priority (low|medium|high|critical).", "medium"];
    }
    if (field === "labels") {
      return ["Reset labels to a list of strings (comma-separated).", []];
    }
    return [`Set front matter field '${field}'.`, value];
  }
  if (action === "normalize_labels") {
    return ["Normalize labels to strings, dropping invalid entries.", null];
  }
  if (action === "set_assignment_owner") {
    return ["Set assignment.owner (who owns this ticket; freeform handle).", value];
  }
  if (action === "reset_verification_commands") {
    return ["Set verification.commands (commands to verify acceptance).", value ?? []];
  }
  if (action === "normalize_verification_commands") {
    return ["Normalize verification.commands to strings, dropping invalid entries.", null];
  }
  if (action === "set_log_event_type") {
    return [`Set event_type in ${logPath} based on the log entry shape.`, null];
  }
  if (action === "normalize_log_context") {
    return [`Normalize context in ${logPath} and synthesize a minimal fallback when required.`, null];
  }
  return ["Apply repair", value];
}

async function promptYesNo(rl, message, defaultValue) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  while (true) {
    const response = (await rl.question(`${message}${suffix}`)).trim().toLowerCase();
    if (!response) {
      return defaultValue;
    }
    if (["y", "yes"].includes(response)) {
      return true;
    }
    if (["n", "no"].includes(response)) {
      return false;
    }
    process.stdout.write("Please enter y or n.\n");
  }
}

async function promptValueForField(rl, field, ticketPath, defaultValue) {
  let current = null;
  if (ticketPath) {
    try {
      const [frontMatter] = loadTicket(ticketPath);
      current = field === "assignment.owner" ? frontMatter.assignment?.owner : frontMatter[field];
    } catch {
      current = null;
    }
  }

  if (field === "labels") {
    const labels = Array.isArray(defaultValue)
      ? defaultValue
      : Array.isArray(current)
      ? current
      : [];
    return promptLabels(rl, labels);
  }

  if (field === "priority") {
    const base = defaultValue ?? current ?? "medium";
    while (true) {
      const response = (await rl.question(`Priority [${base}]: `)).trim().toLowerCase();
      if (!response) {
        return base;
      }
      if (PRIORITY_VALUES.includes(response)) {
        return response;
      }
      process.stdout.write(`Enter one of ${PRIORITY_VALUES.join(", ")}.\n`);
    }
  }

  const fallback = defaultValue ?? current;
  const response = (await rl.question(`${field} [${fallback ?? ""}]: `)).trim();
  if (!response && fallback != null) {
    return fallback;
  }
  if (field === "id") {
    return response || newUuidv7();
  }
  return response || fallback;
}

async function promptLabels(rl, defaultLabels) {
  const existing = defaultLabels.join(", ");
  const response = (await rl.question(`Labels (comma-separated) [${existing}]: `)).trim();
  if (!response) {
    return defaultLabels;
  }
  return response
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function promptCommands(rl, defaultCommands) {
  const existing = defaultCommands.join("; ");
  process.stdout.write("Enter verification commands (comma-separated). Leave blank to keep default.\n");
  const response = (await rl.question(`Commands [${existing}]: `)).trim();
  if (!response) {
    return defaultCommands;
  }
  return response
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function setFrontMatterField(ticketPath, field, value) {
  const [frontMatter, body] = loadTicket(ticketPath);
  frontMatter[field] = value;
  writeTicket(ticketPath, frontMatter, body);
}

function addMissingSections(ticketPath) {
  const [frontMatter, body] = loadTicket(ticketPath);
  let nextBody = body;
  for (const section of ["# Ticket", "## Description", "## Acceptance Criteria", "## Verification"]) {
    if (!nextBody.includes(section)) {
      nextBody += `\n${section}\n(fill in)\n`;
    }
  }
  writeTicket(ticketPath, frontMatter, nextBody);
}

function normalizeCreatedAt(ticketPath) {
  const [frontMatter, body] = loadTicket(ticketPath);
  if (typeof frontMatter.created_at !== "string" || !parseIso(frontMatter.created_at)) {
    frontMatter.created_at = iso8601(nowUtc());
    writeTicket(ticketPath, frontMatter, body);
  }
}

function normalizeLabels(ticketPath) {
  const [frontMatter, body] = loadTicket(ticketPath);
  const labels = Array.isArray(frontMatter.labels)
    ? frontMatter.labels.filter((v) => typeof v === "string")
    : [];
  frontMatter.labels = labels;
  writeTicket(ticketPath, frontMatter, body);
}

function setAssignmentOwner(ticketPath, value) {
  const [frontMatter, body] = loadTicket(ticketPath);
  const assignment =
    frontMatter.assignment && typeof frontMatter.assignment === "object" && !Array.isArray(frontMatter.assignment)
      ? frontMatter.assignment
      : {};
  assignment.owner = value;
  frontMatter.assignment = assignment;
  writeTicket(ticketPath, frontMatter, body);
}

function resetVerificationCommands(ticketPath, commands) {
  const [frontMatter, body] = loadTicket(ticketPath);
  frontMatter.verification = { commands };
  writeTicket(ticketPath, frontMatter, body);
}

function normalizeVerificationCommands(ticketPath) {
  const [frontMatter, body] = loadTicket(ticketPath);
  const rawCommands = Array.isArray(frontMatter.verification?.commands)
    ? frontMatter.verification.commands
    : [];
  frontMatter.verification = {
    commands: rawCommands.filter((v) => typeof v === "string"),
  };
  writeTicket(ticketPath, frontMatter, body);
}

function setLogEventType(logPath) {
  updateJsonl(logPath, (entry) => {
    entry.event_type = inferLogEventType(entry);
    return entry;
  });
}

function normalizeLogContext(logPath) {
  updateJsonl(logPath, (entry) => {
    if (!Array.isArray(entry.context)) {
      entry.context = [];
    }
    entry.context = entry.context.map((value) => String(value).trim()).filter(Boolean);

    const machineEntry = entry.written_by === "tickets" || entry.machine === true;
    const eventType = inferLogEventType(entry);
    if (entry.event_type !== eventType) {
      entry.event_type = eventType;
    }
    if (machineEntry && eventType === "work" && entry.context.length === 0) {
      entry.context = buildFallbackContext(entry);
    }
    return entry;
  });
}

function buildFallbackContext(entry) {
  const items = [];
  if (typeof entry.created_from === "string" && entry.created_from.trim()) {
    items.push(`Handoff from parent ticket ${entry.created_from.trim()}.`);
  }
  if (typeof entry.summary === "string" && entry.summary.trim()) {
    items.push(`Recovered from summary: ${entry.summary.trim()}`);
  }
  if (items.length === 0) {
    items.push("Recovered context was unavailable during automated repair.");
  }
  return items;
}

function inferLogEventType(entry) {
  if (typeof entry.summary === "string" && /^Status (changed|reaffirmed)\b/.test(entry.summary)) {
    return "status";
  }
  return "work";
}

function updateJsonl(logPath, updateEntry) {
  const entries = readJsonl(logPath);
  const content = entries.map((entry) => JSON.stringify(updateEntry(entry))).join("\n");
  fs.writeFileSync(logPath, `${content}\n`);
}
