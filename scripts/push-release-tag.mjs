#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command, options = {}) {
  const output = execSync(command, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...options,
  });

  if (typeof output !== "string") {
    return "";
  }

  return output.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const repoRoot = process.cwd();
const pkgJsonPath = path.join(repoRoot, "packages", "tickets", "package.json");

if (!fs.existsSync(pkgJsonPath)) {
  fail(`Cannot find package file at ${pkgJsonPath}`);
}

const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
const version = pkg.version;

if (!version) {
  fail("packages/tickets/package.json does not contain a version.");
}

const tagName = `v${version}`;

const dirty = run("git status --porcelain");

if (dirty.length > 0) {
  fail("Working tree is not clean. Commit or stash changes before tagging.");
}

try {
  run(`git rev-parse --verify "refs/tags/${tagName}"`);
  fail(`Tag ${tagName} already exists locally.`);
} catch {
  // Tag does not exist locally.
}

process.stdout.write(`Creating annotated tag ${tagName}...\n`);
run(`git tag -a "${tagName}" -m "@picoai/tickets ${version}"`, { stdio: "inherit" });

process.stdout.write(`Pushing tag ${tagName} to origin...\n`);
run(`git push origin "${tagName}"`, { stdio: "inherit" });

process.stdout.write(`Done. GitHub Release workflow should run for ${tagName}.\n`);
