import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "yaml";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, "..");
const binPath = path.join(packageRoot, "bin", "tickets.js");

function runCli(cwd, args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tickets-"));
}

function readTicketFrontMatter(cwd, ticketId) {
  const ticketPath = path.join(cwd, ".tickets", ticketId, "ticket.md");
  const text = fs.readFileSync(ticketPath, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `front matter missing in ${ticketPath}`);
  return yaml.parse(match[1]);
}

function readPlanningIndex(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".tickets", "derived", "planning-index.json"), "utf8"));
}

test("init creates expected structure", () => {
  const tmp = makeTmpDir();
  const result = runCli(tmp, ["init"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(tmp, "TICKETS.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".tickets")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".tickets", "config.yml")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".tickets", "skills", "tickets", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS_EXAMPLE.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS.md")), false);
  const ticketsDoc = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  assert.match(ticketsDoc, /@picoai\/tickets:managed:start/);
  assert.match(ticketsDoc, /## Spec version/);
  assert.match(ticketsDoc, /## Core planning model/);
  assert.doesNotMatch(ticketsDoc, /@picoai\/tickets:tickets-md:start/);
  assert.equal(
    fs.existsSync(path.join(tmp, ".tickets", "spec", "version", "20260317-2-tickets-spec.md")),
    true,
  );
});

test("init --apply preserves custom content and updates managed TICKETS.md + AGENTS.md sections", () => {
  const tmp = makeTmpDir();
  fs.mkdirSync(path.join(tmp, ".tickets", "spec", "version"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "TICKETS.md"), "# Local tickets doc\n\nCustom section.\n");
  fs.writeFileSync(path.join(tmp, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "stale spec\n");
  fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Local AGENTS\n\nCustom policy.\n");
  fs.writeFileSync(path.join(tmp, "TICKETS.override.md"), "# Local override\n");
  fs.mkdirSync(path.join(tmp, ".tickets"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".tickets", "config.yml"), "workflow:\n  mode: skill_first\n");

  const result = runCli(tmp, ["init", "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ticketsDoc = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  assert.match(ticketsDoc, /# Local tickets doc/);
  assert.match(ticketsDoc, /Custom section\./);
  assert.match(ticketsDoc, /@picoai\/tickets:managed:start/);
  assert.match(ticketsDoc, /applied_at:/);
  assert.match(ticketsDoc, /written_by: @picoai\/tickets@/);
  assert.match(ticketsDoc, /## Spec version/);
  assert.doesNotMatch(ticketsDoc, /@picoai\/tickets:tickets-md:start/);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS_EXAMPLE.md")), false);
  assert.match(fs.readFileSync(path.join(tmp, ".tickets", "config.yml"), "utf8"), /workflow:\n  mode: skill_first/);
  assert.equal(fs.readFileSync(path.join(tmp, "TICKETS.override.md"), "utf8"), "# Local override\n");
  assert.equal(
    fs.existsSync(path.join(tmp, ".tickets", "skills", "tickets", "SKILL.md")),
    true,
  );
  assert.equal(
    fs.readFileSync(path.join(tmp, ".tickets", "spec", "version", "20260317-2-tickets-spec.md"), "utf8"),
    fs.readFileSync(path.join(packageRoot, ".tickets", "spec", "version", "20260317-2-tickets-spec.md"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(path.join(tmp, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "utf8"),
    fs.readFileSync(path.join(packageRoot, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "utf8"),
  );

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /Custom policy\./);
  assert.match(agentsMd, /^## Ticketing Workflow$/m);
  assert.match(agentsMd, /^### Required Behavior$/m);
  assert.match(agentsMd, /^### Bootstrapping TICKETS\.md$/m);
  assert.match(agentsMd, /\.tickets\/skills\/tickets\/SKILL\.md/);
  assert.match(agentsMd, /\.tickets\/config\.yml/);
  assert.doesNotMatch(agentsMd, /<!-- @picoai\/tickets:agents:start -->/);
  assert.doesNotMatch(agentsMd, /^# Ticketing Workflow$/m);
  assert.doesNotMatch(agentsMd, /^#+\s+#+\s*Ticketing Workflow$/m);

  const secondRun = runCli(tmp, ["init", "--apply"]);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const ticketsDocAfter = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  assert.equal((ticketsDocAfter.match(/@picoai\/tickets:managed:start/g) ?? []).length, 1);
  const agentsMdAfter = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.equal((agentsMdAfter.match(/^## Ticketing Workflow$/gm) ?? []).length, 1);
});

test("init without --apply does not modify existing TICKETS.md", () => {
  const tmp = makeTmpDir();
  const original = "# Keep this file\n\nNo edits please.\n";
  fs.writeFileSync(path.join(tmp, "TICKETS.md"), original);

  const result = runCli(tmp, ["init"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8"), original);
});

test("init --apply creates AGENTS.md when missing", () => {
  const tmp = makeTmpDir();
  const result = runCli(tmp, ["init", "--apply"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS_EXAMPLE.md")), false);

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /^## Ticketing Workflow$/m);
  assert.match(agentsMd, /^### Required Behavior$/m);
  assert.match(agentsMd, /^### Bootstrapping TICKETS\.md$/m);
  assert.doesNotMatch(agentsMd, /^# Ticketing Workflow$/m);
  assert.doesNotMatch(agentsMd, /^#+\s+#+\s*Ticketing Workflow$/m);
});

test("init --apply migrates legacy marker-based AGENTS content", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(
    path.join(tmp, "AGENTS.md"),
    [
      "# Local AGENTS",
      "",
      "Before section.",
      "",
      "<!-- @picoai/tickets:agents:start -->",
      "# Ticketing Workflow",
      "",
      "## Required behavior",
      "- old instruction",
      "",
      "## Bootstrapping TICKETS.md",
      "- old bootstrapping",
      "<!-- @picoai/tickets:agents:end -->",
      "",
      "After section.",
      "",
    ].join("\n"),
  );

  const result = runCli(tmp, ["init", "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /Before section\./);
  assert.match(agentsMd, /After section\./);
  assert.match(agentsMd, /^## Ticketing Workflow$/m);
  assert.match(agentsMd, /^### Required Behavior$/m);
  assert.doesNotMatch(agentsMd, /@picoai\/tickets:agents:start/);
  assert.doesNotMatch(agentsMd, /^# Ticketing Workflow$/m);
});

test("init --apply migrates legacy H1 Ticketing Workflow block", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(
    path.join(tmp, "AGENTS.md"),
    [
      "# Ticketing Workflow",
      "",
      "Legacy intro",
      "",
      "## Required behavior",
      "- old behavior",
      "",
      "## Bootstrapping TICKETS.md",
      "- old bootstrap",
      "",
      "## Team Customizations",
      "- Keep me",
      "",
    ].join("\n"),
  );

  const result = runCli(tmp, ["init", "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /^## Ticketing Workflow$/m);
  assert.match(agentsMd, /^### Required Behavior$/m);
  assert.match(agentsMd, /^## Team Customizations$/m);
  assert.match(agentsMd, /- Keep me/);
  assert.doesNotMatch(agentsMd, /^# Ticketing Workflow$/m);
});

test("new creates ticket that validates", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);

  const ticketDirs = fs.readdirSync(path.join(tmp, ".tickets"));
  assert.equal(ticketDirs.length > 0, true);

  const ticketPath = path.join(tmp, ".tickets", newResult.stdout.trim(), "ticket.md");
  const ticketText = fs.readFileSync(ticketPath, "utf8");
  assert.match(ticketText, /version:\s+3/);
  assert.match(ticketText, /node_type:\s+work/);

  const validateResult = runCli(tmp, ["validate"]);
  assert.equal(validateResult.status, 0, validateResult.stderr || validateResult.stdout);
});

test("init --examples generates tickets and logs that validate", () => {
  const tmp = makeTmpDir();
  const initResult = runCli(tmp, ["init", "--examples"]);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);

  const validateResult = runCli(tmp, ["validate"]);
  assert.equal(validateResult.status, 0, validateResult.stderr || validateResult.stdout);
});

test("log appends jsonl entries", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0);
  const ticketId = newResult.stdout.trim();

  const logResult = runCli(tmp, [
    "log",
    "--ticket",
    ticketId,
    "--context",
    "Implemented validator flow",
    "--actor-type",
    "agent",
    "--actor-id",
    "tester",
    "--summary",
    "did stuff",
    "--machine",
  ]);
  assert.equal(logResult.status, 0, logResult.stderr || logResult.stdout);

  const logsDir = path.join(tmp, ".tickets", ticketId, "logs");
  const logs = fs.readdirSync(logsDir).filter((name) => name.endsWith(".jsonl"));
  assert.equal(logs.length > 0, true);

  const entries = fs
    .readFileSync(path.join(logsDir, logs[0]), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(entries[0].summary, "did stuff");
  assert.equal(entries[0].written_by, "tickets");
  assert.equal(entries[0].event_type, "work");
  assert.deepEqual(entries[0].context, ["Implemented validator flow"]);
});

test("log infers actor defaults from environment and local user", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);
  const ticketId = newResult.stdout.trim();

  const envActor = runCli(
    tmp,
    [
      "log",
      "--ticket",
      ticketId,
      "--summary",
      "planned next step",
      "--context",
      "Parent acceptance criteria copied",
      "--run-started",
      "20260311T100000.000Z",
      "--run-id",
      "log-1",
    ],
    {
      env: {
        TICKETS_ACTOR_ID: "agent:planner",
      },
    },
  );
  assert.equal(envActor.status, 0, envActor.stderr || envActor.stdout);

  let logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T100000.000Z-log-1.jsonl");
  let entries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(entries[0].actor_type, "agent");
  assert.equal(entries[0].actor_id, "agent:planner");
  assert.equal(entries[0].event_type, "work");
  assert.deepEqual(entries[0].context, ["Parent acceptance criteria copied"]);

  const userDefault = runCli(
    tmp,
    [
      "log",
      "--ticket",
      ticketId,
      "--summary",
      "investigated issue",
      "--run-started",
      "20260311T110000.000Z",
      "--run-id",
      "log-2",
    ],
    {
      env: {
        TICKETS_ACTOR_ID: "",
        TICKETS_ACTOR_TYPE: "",
        USER: "alice",
      },
    },
  );
  assert.equal(userDefault.status, 0, userDefault.stderr || userDefault.stdout);

  logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T110000.000Z-log-2.jsonl");
  entries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(entries[0].actor_type, "human");
  assert.equal(entries[0].actor_id, "@alice");
});

test("status updates ticket and always appends an attributed log entry", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);
  const ticketId = newResult.stdout.trim();

  const statusResult = runCli(tmp, [
    "status",
    "--ticket",
    ticketId,
    "--status",
    "doing",
    "--actor-type",
    "agent",
    "--actor-id",
    "agent:codex",
    "--context",
    "Rollout context changed after release review",
    "--run-started",
    "20260311T120000.000Z",
    "--run-id",
    "run-1",
  ]);
  assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);

  const ticketPath = path.join(tmp, ".tickets", ticketId, "ticket.md");
  const ticketText = fs.readFileSync(ticketPath, "utf8");
  assert.match(ticketText, /status:\s+doing/);

  const logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T120000.000Z-run-1.jsonl");
  const entries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].actor_type, "agent");
  assert.equal(entries[0].actor_id, "agent:codex");
  assert.equal(entries[0].summary, "Status changed from todo to doing");
  assert.equal(entries[0].event_type, "status");
  assert.deepEqual(entries[0].context, ["Rollout context changed after release review"]);
  assert.equal(entries[0].written_by, "tickets");
});

test("status infers actor defaults from environment and local user", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);
  const ticketId = newResult.stdout.trim();

  const envActor = runCli(
    tmp,
    ["status", "--ticket", ticketId, "--status", "doing", "--run-started", "20260311T130000.000Z", "--run-id", "run-2"],
    {
      env: {
        TICKETS_ACTOR_ID: "agent:planner",
      },
    },
  );
  assert.equal(envActor.status, 0, envActor.stderr || envActor.stdout);

  let logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T130000.000Z-run-2.jsonl");
  let entries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(entries[0].actor_type, "agent");
  assert.equal(entries[0].actor_id, "agent:planner");

  const userDefault = runCli(
    tmp,
    ["status", "--ticket", ticketId, "--status", "blocked", "--run-started", "20260311T140000.000Z", "--run-id", "run-3"],
    {
      env: {
        TICKETS_ACTOR_ID: "",
        TICKETS_ACTOR_TYPE: "",
        USER: "alice",
      },
    },
  );
  assert.equal(userDefault.status, 0, userDefault.stderr || userDefault.stdout);

  logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T140000.000Z-run-3.jsonl");
  entries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(entries[0].actor_type, "human");
  assert.equal(entries[0].actor_id, "@alice");
  assert.equal(entries[0].event_type, "status");
});

test("machine work logs require context", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Test Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);
  const ticketId = newResult.stdout.trim();

  const missingContext = runCli(tmp, [
    "log",
    "--ticket",
    ticketId,
    "--summary",
    "implemented change",
    "--machine",
  ]);
  assert.equal(missingContext.status, 2, missingContext.stderr || missingContext.stdout);
  assert.match(missingContext.stderr, /Machine-written work logs require at least one --context item/);
});

test("list --text searches ticket body content", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const first = runCli(tmp, ["new", "--title", "Alpha Ticket"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstId = first.stdout.trim();

  const second = runCli(tmp, ["new", "--title", "Beta Ticket"]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondId = second.stdout.trim();

  const firstPath = path.join(tmp, ".tickets", firstId, "ticket.md");
  const secondPath = path.join(tmp, ".tickets", secondId, "ticket.md");

  fs.writeFileSync(
    firstPath,
    fs.readFileSync(firstPath, "utf8").replace("(fill in)", "Contains orchestration handoff details for agent swarm."),
  );
  fs.writeFileSync(
    secondPath,
    fs.readFileSync(secondPath, "utf8").replace("(fill in)", "Unrelated body text."),
  );

  const listResult = runCli(tmp, ["list", "--text", "orchestration handoff", "--json"]);
  assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
  const rows = JSON.parse(listResult.stdout);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, firstId);
});

test("repair fixes basic log issues for event_type and context", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const newResult = runCli(tmp, ["new", "--title", "Repair Log Ticket"]);
  assert.equal(newResult.status, 0, newResult.stderr || newResult.stdout);
  const ticketId = newResult.stdout.trim();

  const logResult = runCli(tmp, [
    "log",
    "--ticket",
    ticketId,
    "--summary",
    "Implemented change for repair test",
    "--context",
    "Original valid context",
    "--machine",
    "--run-started",
    "20260311T150000.000Z",
    "--run-id",
    "repair-log-1",
  ]);
  assert.equal(logResult.status, 0, logResult.stderr || logResult.stdout);

  const logPath = path.join(tmp, ".tickets", ticketId, "logs", "20260311T150000.000Z-repair-log-1.jsonl");
  const originalEntry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  const brokenEntry = { ...originalEntry };
  delete brokenEntry.event_type;
  brokenEntry.context = ["", 42];

  const missingContextEntry = {
    ...originalEntry,
    summary: "Second repaired machine log entry",
  };
  delete missingContextEntry.context;

  fs.writeFileSync(logPath, `${JSON.stringify(brokenEntry)}\n${JSON.stringify(missingContextEntry)}\n`);

  const validateBefore = runCli(tmp, ["validate"]);
  assert.equal(validateBefore.status, 1, validateBefore.stderr || validateBefore.stdout);
  assert.match(validateBefore.stdout, /event_type missing/);

  const repairResult = runCli(tmp, ["repair", "--non-interactive"]);
  assert.equal(repairResult.status, 0, repairResult.stderr || repairResult.stdout);
  assert.match(repairResult.stdout, /set event_type/);
  assert.match(repairResult.stdout, /normalized context/);

  const repairedEntries = fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(repairedEntries[0].event_type, "work");
  assert.deepEqual(repairedEntries[0].context, ["42"]);
  assert.equal(repairedEntries[1].event_type, "work");
  assert.deepEqual(repairedEntries[1].context, ["Recovered from summary: Second repaired machine log entry"]);

  const validateAfter = runCli(tmp, ["validate"]);
  assert.equal(validateAfter.status, 0, validateAfter.stderr || validateAfter.stdout);
});

test("new accepts planning fields and list exposes derived planning metadata", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const group = runCli(tmp, [
    "new",
    "--title",
    "Feature Alpha",
    "--node-type",
    "group",
    "--lane",
    "build",
    "--rank",
    "1",
    "--horizon",
    "current",
  ]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const groupId = group.stdout.trim();

  const work = runCli(tmp, [
    "new",
    "--title",
    "Feature Alpha API",
    "--group-id",
    groupId,
    "--lane",
    "build",
    "--rank",
    "2",
    "--horizon",
    "current",
  ]);
  assert.equal(work.status, 0, work.stderr || work.stdout);

  const listResult = runCli(tmp, ["list", "--group", groupId, "--json"]);
  assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
  const rows = JSON.parse(listResult.stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].node_type, "work");
  assert.equal(rows[0].lane, "build");
  assert.equal(rows[0].rank, 2);
  assert.equal(rows[0].horizon, "current");
  assert.deepEqual(rows[0].group_ids, [groupId]);
});

test("claim acquires, filters, releases, and force-overrides advisory leases", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const created = runCli(tmp, ["new", "--title", "Claimed Ticket"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const ticketId = created.stdout.trim();

  const claim = runCli(tmp, [
    "claim",
    "--ticket",
    ticketId,
    "--actor-type",
    "agent",
    "--actor-id",
    "agent:alpha",
    "--run-started",
    "20260317T180000.000Z",
    "--run-id",
    "claim-1",
  ]);
  assert.equal(claim.status, 0, claim.stderr || claim.stdout);
  assert.match(claim.stdout, /Acquired claim/);

  const blockedClaim = runCli(tmp, [
    "claim",
    "--ticket",
    ticketId,
    "--actor-type",
    "agent",
    "--actor-id",
    "agent:beta",
  ]);
  assert.equal(blockedClaim.status, 1, blockedClaim.stderr || blockedClaim.stdout);
  assert.match(blockedClaim.stdout, /Ticket is claimed by agent:alpha/);

  const listClaimed = runCli(tmp, ["list", "--claimed", "--json"]);
  const claimedRows = JSON.parse(listClaimed.stdout);
  assert.equal(claimedRows.length, 1);
  assert.equal(claimedRows[0].active_claim.holder_id, "agent:alpha");

  const forcedClaim = runCli(tmp, [
    "claim",
    "--ticket",
    ticketId,
    "--actor-type",
    "agent",
    "--actor-id",
    "agent:beta",
    "--force",
    "--reason",
    "Taking ownership after triage",
  ]);
  assert.equal(forcedClaim.status, 0, forcedClaim.stderr || forcedClaim.stdout);
  assert.match(forcedClaim.stdout, /Overrode claim/);

  const release = runCli(tmp, [
    "claim",
    "--ticket",
    ticketId,
    "--actor-type",
    "agent",
    "--actor-id",
    "agent:beta",
    "--release",
  ]);
  assert.equal(release.status, 0, release.stderr || release.stdout);

  const unclaimed = runCli(tmp, ["list", "--claimed", "--json"]);
  assert.deepEqual(JSON.parse(unclaimed.stdout), []);
});

test("plan reports rollups and ready queue with merged and dropped outcomes excluded from denominator", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const feature = runCli(tmp, ["new", "--title", "Feature Alpha", "--node-type", "group"]);
  assert.equal(feature.status, 0, feature.stderr || feature.stdout);
  const featureId = feature.stdout.trim();

  const completed = runCli(tmp, [
    "new",
    "--title",
    "Completed work",
    "--group-id",
    featureId,
    "--status",
    "done",
    "--resolution",
    "completed",
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);

  const dropped = runCli(tmp, [
    "new",
    "--title",
    "Dropped work",
    "--group-id",
    featureId,
    "--status",
    "canceled",
    "--resolution",
    "dropped",
  ]);
  assert.equal(dropped.status, 0, dropped.stderr || dropped.stdout);

  const ready = runCli(tmp, [
    "new",
    "--title",
    "Ready work",
    "--group-id",
    featureId,
    "--lane",
    "build",
    "--rank",
    "1",
    "--horizon",
    "current",
  ]);
  assert.equal(ready.status, 0, ready.stderr || ready.stdout);

  const planResult = runCli(tmp, ["plan", "--group", featureId, "--format", "json"]);
  assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
  const summary = JSON.parse(planResult.stdout);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].rollup.total_leaf, 3);
  assert.equal(summary.groups[0].rollup.active_leaf, 2);
  assert.equal(summary.groups[0].rollup.done_completed, 1);
  assert.equal(summary.groups[0].rollup.dropped, 1);
  assert.equal(summary.groups[0].rollup.percent_complete, 0.5);
  assert.equal(summary.ready.length, 1);
  assert.equal(summary.ready[0].title, "Ready work");
});

test("graph view portfolio includes contains and precedes edges", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const group = runCli(tmp, ["new", "--title", "Feature Alpha", "--node-type", "group"]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const groupId = group.stdout.trim();

  const first = runCli(tmp, [
    "new",
    "--title",
    "API work",
    "--group-id",
    groupId,
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstId = first.stdout.trim();

  const second = runCli(tmp, [
    "new",
    "--title",
    "UI work",
    "--group-id",
    groupId,
    "--precedes",
    firstId,
  ]);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const graph = runCli(tmp, ["graph", "--view", "portfolio", "--format", "json"]);
  assert.equal(graph.status, 0, graph.stderr || graph.stdout);
  const graphPath = graph.stdout.trim();
  const json = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  assert.equal(json.edges.some((edge) => edge.type === "contains"), true);
  assert.equal(json.edges.some((edge) => edge.type === "precedes"), true);
});

test("validate reports invalid repo config", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  fs.writeFileSync(path.join(tmp, ".tickets", "config.yml"), "workflow:\n  mode: nope\n");

  const validate = runCli(tmp, ["validate"]);
  assert.equal(validate.status, 1, validate.stderr || validate.stdout);
  assert.match(validate.stdout, /workflow\.mode must be one of/);
});

test("generated TICKETS and repo skill stay aligned on planning concepts", () => {
  const tmp = makeTmpDir();
  const result = runCli(tmp, ["init", "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ticketsDoc = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  const skillDoc = fs.readFileSync(path.join(tmp, ".tickets", "skills", "tickets", "SKILL.md"), "utf8");

  assert.match(ticketsDoc, /planning\.node_type/);
  assert.match(ticketsDoc, /claims are optional advisory leases/i);
  assert.match(ticketsDoc, /\.tickets\/config\.yml/);
  assert.match(skillDoc, /planning\.node_type/);
  assert.match(skillDoc, /Claims/);
  assert.match(skillDoc, /\.tickets\/config\.yml/);
});

test("plan exposes effective semantics from repo config", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init", "--apply"]).status, 0);
  fs.writeFileSync(
    path.join(tmp, ".tickets", "config.yml"),
    [
      "workflow:",
      "  mode: auto",
      "defaults:",
      "  planning:",
      "    node_type: work",
      "    lane: null",
      "    horizon: null",
      "  claims:",
      "    ttl_minutes: 60",
      "semantics:",
      "  terms:",
      "    stage:",
      "      field: planning.lane",
      "      description: Stage maps to lane in this repo.",
      "",
    ].join("\n"),
  );

  const result = runCli(tmp, ["plan", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.semantics.stage.field, "planning.lane");
});

test("new applies defaults, inherits planning from parent groups, and auto-assigns rank", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  fs.writeFileSync(
    path.join(tmp, ".tickets", "config.yml"),
    [
      "workflow:",
      "  mode: auto",
      "defaults:",
      "  planning:",
      "    node_type: work",
      "    lane: backlog",
      "    horizon: next",
      "  claims:",
      "    ttl_minutes: 60",
      "semantics:",
      "  terms: {}",
      "views: {}",
      "",
    ].join("\n"),
  );

  const group = runCli(tmp, ["new", "--title", "Feature", "--node-type", "group", "--lane", "build", "--horizon", "current"]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const groupId = group.stdout.trim();

  const child = runCli(tmp, ["new", "--title", "Child", "--group-id", groupId]);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const childFrontMatter = readTicketFrontMatter(tmp, child.stdout.trim());
  assert.equal(childFrontMatter.planning.lane, "build");
  assert.equal(childFrontMatter.planning.horizon, "current");
  assert.equal(childFrontMatter.planning.rank, 1);

  const standalone = runCli(tmp, ["new", "--title", "Standalone"]);
  assert.equal(standalone.status, 0, standalone.stderr || standalone.stdout);
  const standaloneFrontMatter = readTicketFrontMatter(tmp, standalone.stdout.trim());
  assert.equal(standaloneFrontMatter.planning.lane, "backlog");
  assert.equal(standaloneFrontMatter.planning.horizon, "next");
  assert.equal(standaloneFrontMatter.planning.rank, 1);
});

test("new fails when parent groups disagree on inferred lane", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const first = runCli(tmp, ["new", "--title", "Group A", "--node-type", "group", "--lane", "build"]);
  const second = runCli(tmp, ["new", "--title", "Group B", "--node-type", "group", "--lane", "launch"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const child = runCli(tmp, [
    "new",
    "--title",
    "Child",
    "--group-id",
    first.stdout.trim(),
    "--group-id",
    second.stdout.trim(),
  ]);
  assert.notEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stderr, /Cannot infer --lane/);
});

test("new rejects group-id targets that are not group or checkpoint tickets", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  const work = runCli(tmp, ["new", "--title", "Work"]);
  assert.equal(work.status, 0, work.stderr || work.stdout);

  const child = runCli(tmp, ["new", "--title", "Child", "--group-id", work.stdout.trim()]);
  assert.notEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stderr, /must reference a group or checkpoint/);
});

test("list returns sorted rows with claim and blocked metadata", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const dependency = runCli(tmp, ["new", "--title", "Dependency", "--lane", "build", "--rank", "1"]);
  assert.equal(dependency.status, 0, dependency.stderr || dependency.stdout);
  const dependencyId = dependency.stdout.trim();

  const blocked = runCli(tmp, [
    "new",
    "--title",
    "Blocked work",
    "--dependency",
    dependencyId,
    "--lane",
    "build",
    "--rank",
    "3",
  ]);
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);

  const ready = runCli(tmp, [
    "new",
    "--title",
    "Ready work",
    "--priority",
    "critical",
    "--lane",
    "build",
    "--rank",
    "2",
  ]);
  assert.equal(ready.status, 0, ready.stderr || ready.stdout);
  assert.equal(runCli(tmp, ["claim", "--ticket", ready.stdout.trim(), "--actor-id", "agent:alpha"]).status, 0);

  const list = runCli(tmp, ["list", "--json"]);
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const rows = JSON.parse(list.stdout);
  assert.equal(rows[0].title, "Ready work");
  assert.match(rows[0].claim_summary, /agent:alpha/);
  const blockedRow = rows.find((row) => row.title === "Blocked work");
  assert.deepEqual(blockedRow.blocked_by.dependencies, [dependencyId]);
});

test("plan reports ready, active, blocked, and group rollups with claim summaries", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);

  const group = runCli(tmp, ["new", "--title", "Feature", "--node-type", "group", "--lane", "build", "--horizon", "current"]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const groupId = group.stdout.trim();

  const ready = runCli(tmp, ["new", "--title", "Ready", "--group-id", groupId, "--lane", "build", "--rank", "1", "--horizon", "current"]);
  const active = runCli(tmp, ["new", "--title", "Active", "--group-id", groupId, "--lane", "build", "--rank", "2", "--horizon", "current", "--status", "doing"]);
  const dependency = runCli(tmp, ["new", "--title", "Prereq", "--group-id", groupId, "--lane", "build", "--rank", "3", "--horizon", "current"]);
  const blocked = runCli(tmp, ["new", "--title", "Blocked", "--group-id", groupId, "--dependency", dependency.stdout.trim(), "--lane", "build", "--rank", "4", "--horizon", "current"]);
  assert.equal(ready.status, 0, ready.stderr || ready.stdout);
  assert.equal(active.status, 0, active.stderr || active.stdout);
  assert.equal(dependency.status, 0, dependency.stderr || dependency.stdout);
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
  assert.equal(runCli(tmp, ["claim", "--ticket", ready.stdout.trim(), "--actor-id", "agent:planner"]).status, 0);

  const result = runCli(tmp, ["plan", "--group", groupId, "--format", "json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ready.length, 2);
  assert.equal(summary.active.length, 1);
  assert.equal(summary.blocked.length, 1);
  assert.match(summary.ready[0].claim_summary || "", /agent:planner/);
  assert.equal(summary.groups.length, 1);
});

test("graph json includes planning metadata on nodes", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  const group = runCli(tmp, ["new", "--title", "Feature", "--node-type", "group", "--lane", "build", "--horizon", "current"]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const child = runCli(tmp, ["new", "--title", "Child", "--group-id", group.stdout.trim(), "--lane", "build", "--rank", "1", "--horizon", "current"]);
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const graph = runCli(tmp, ["graph", "--view", "portfolio", "--format", "json"]);
  assert.equal(graph.status, 0, graph.stderr || graph.stdout);
  const json = JSON.parse(fs.readFileSync(graph.stdout.trim(), "utf8"));
  const node = json.nodes.find((entry) => entry.title === "Child");
  assert.equal(node.node_type, "work");
  assert.equal(node.lane, "build");
  assert.equal(node.rank, 1);
  assert.equal(node.horizon, "current");
  assert.equal(Array.isArray(node.group_ids), true);
});

test("validate reports planning topology issues", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  const group = runCli(tmp, ["new", "--title", "Feature", "--node-type", "group", "--lane", "build"]);
  assert.equal(group.status, 0, group.stderr || group.stdout);
  const groupId = group.stdout.trim();
  const first = runCli(tmp, ["new", "--title", "One", "--group-id", groupId, "--lane", "build", "--rank", "1"]);
  const second = runCli(tmp, ["new", "--title", "Two", "--group-id", groupId, "--lane", "build", "--rank", "1"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const frontMatter = readTicketFrontMatter(tmp, first.stdout.trim());
  frontMatter.dependencies = ["0195a1b7-4a17-7c2e-8db2-4d5cb0f0d643"];
  frontMatter.planning.precedes = [frontMatter.id];
  const ticketPath = path.join(tmp, ".tickets", first.stdout.trim(), "ticket.md");
  fs.writeFileSync(ticketPath, `---\n${yaml.stringify(frontMatter).trimEnd()}\n---\n# Ticket\n\n## Description\n(fill in)\n\n## Acceptance Criteria\n- [ ] Define clear, checkable outcomes.\n\n## Verification\n- (add commands or steps)\n`);

  const validate = runCli(tmp, ["validate"]);
  assert.equal(validate.status, 1, validate.stderr || validate.stdout);
  assert.match(validate.stdout, /references missing ticket/);
  assert.match(validate.stdout, /must not contain the ticket's own id/);
  assert.match(validate.stdout, /planning\.rank conflicts with another ticket/);
});

test("derived planning index is created, refreshed, and rebuilt when stale", () => {
  const tmp = makeTmpDir();
  assert.equal(runCli(tmp, ["init"]).status, 0);
  const ticket = runCli(tmp, ["new", "--title", "Indexed"]);
  assert.equal(ticket.status, 0, ticket.stderr || ticket.stdout);
  const ticketId = ticket.stdout.trim();

  const firstList = runCli(tmp, ["list", "--json"]);
  assert.equal(firstList.status, 0, firstList.stderr || firstList.stdout);
  const firstIndex = readPlanningIndex(tmp);
  assert.ok(firstIndex.index_format_id);

  assert.equal(runCli(tmp, ["claim", "--ticket", ticketId, "--actor-id", "agent:index"]).status, 0);
  const afterClaim = readPlanningIndex(tmp);
  const indexedRow = afterClaim.rows.find((row) => row.id === ticketId);
  assert.equal(indexedRow.active_claim.holder_id, "agent:index");

  const tampered = { ...afterClaim, index_format_id: "0195a1b7-4a17-7c2e-8db2-4d5cb0f0d699" };
  fs.writeFileSync(path.join(tmp, ".tickets", "derived", "planning-index.json"), `${JSON.stringify(tampered, null, 2)}\n`);

  const secondList = runCli(tmp, ["list", "--json"]);
  assert.equal(secondList.status, 0, secondList.stderr || secondList.stdout);
  const rebuilt = readPlanningIndex(tmp);
  assert.notEqual(rebuilt.index_format_id, tampered.index_format_id);
});
