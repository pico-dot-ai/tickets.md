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

function runCli(cwd, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
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
  assert.match(ticketsDoc, /@picoai\/tickets:tickets-md:start/);
  assert.match(ticketsDoc, /spec_version: 1/);
  assert.equal(
    fs.existsSync(path.join(tmp, ".tickets", "spec", "version", "20260205-tickets-spec.md")),
    true,
  );
});

test("init --apply refreshes templates and upserts AGENTS.md section", () => {
  const tmp = makeTmpDir();
  fs.mkdirSync(path.join(tmp, ".tickets", "spec", "version"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "TICKETS.md"), "# Local tickets doc\n\nCustom section.\n");
  fs.writeFileSync(path.join(tmp, ".tickets", "spec", "version", "20260205-tickets-spec.md"), "stale spec\n");
  fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Local AGENTS\n\nCustom policy.\n");

  const result = runCli(tmp, ["init", "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ticketsDoc = fs.readFileSync(path.join(tmp, "TICKETS.md"), "utf8");
  assert.match(ticketsDoc, /# Local tickets doc/);
  assert.match(ticketsDoc, /Custom section\./);
  assert.match(ticketsDoc, /@picoai\/tickets:tickets-md:start/);
  assert.match(ticketsDoc, /## Spec version/);
  assert.equal(fs.existsSync(path.join(tmp, "AGENTS_EXAMPLE.md")), false);
  assert.equal(
    fs.readFileSync(path.join(tmp, ".tickets", "spec", "version", "20260205-tickets-spec.md"), "utf8"),
    fs.readFileSync(path.join(packageRoot, ".tickets", "spec", "version", "20260205-tickets-spec.md"), "utf8"),
  );

  const agentsMd = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /Custom policy\./);
  assert.match(agentsMd, /<!-- @picoai\/tickets:agents:start -->/);
  assert.match(agentsMd, /## Required behavior/);

  const secondRun = runCli(tmp, ["init", "--apply"]);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const agentsMdAfter = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
  assert.equal((agentsMdAfter.match(/@picoai\/tickets:agents:start/g) ?? []).length, 1);
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
  assert.match(agentsMd, /<!-- @picoai\/tickets:agents:start -->/);
  assert.match(agentsMd, /# Ticketing Workflow/);
  assert.match(agentsMd, /## Required behavior/);
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
});
