import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

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

test("init creates expected structure", () => {
  const tmp = makeTmpDir();
  const result = runCli(tmp, ["init"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(tmp, "TICKETS.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".tickets")), true);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS_EXAMPLE.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS.md")), false);
  const ticketsDoc = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  assert.match(ticketsDoc, /@picoai\/tickets:managed:start/);
  assert.match(ticketsDoc, /## Spec version/);
  assert.doesNotMatch(ticketsDoc, /@picoai\/tickets:tickets-md:start/);
  assert.equal(
    fs.existsSync(path.join(tmp, ".tickets", "spec", "version", "20260311-tickets-spec.md")),
    true,
  );
});

test("init --apply preserves custom content and updates managed TICKETS.md + AGENTS.md sections", () => {
  const tmp = makeTmpDir();
  fs.mkdirSync(path.join(tmp, ".tickets", "spec", "version"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "TICKETS.md"), "# Local tickets doc\n\nCustom section.\n");
  fs.writeFileSync(path.join(tmp, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "stale spec\n");
  fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Local AGENTS\n\nCustom policy.\n");

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
  assert.equal(
    fs.readFileSync(path.join(tmp, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "utf8"),
    fs.readFileSync(path.join(packageRoot, ".tickets", "spec", "version", "20260311-tickets-spec.md"), "utf8"),
  );

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /Custom policy\./);
  assert.match(agentsMd, /^## Ticketing Workflow$/m);
  assert.match(agentsMd, /^### Required Behavior$/m);
  assert.match(agentsMd, /^### Bootstrapping TICKETS\.md$/m);
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
