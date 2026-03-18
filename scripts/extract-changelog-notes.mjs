#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const version = process.argv[2];

if (!version) {
  fail("Usage: extract-changelog-notes.mjs <version>");
}

const changelogPath = path.resolve(process.cwd(), "CHANGELOG.md");

if (!fs.existsSync(changelogPath)) {
  fail(`CHANGELOG.md not found at ${changelogPath}`);
}

const contents = fs.readFileSync(changelogPath, "utf8");
const lines = contents.split(/\r?\n/);
const headingPattern = new RegExp(`^## \\[${escapeRegex(version)}\\](?:\\s+-\\s+.*)?$`);

const startIndex = lines.findIndex((line) => headingPattern.test(line));

if (startIndex === -1) {
  fail(`No changelog entry found for version ${version}.`);
}

let endIndex = lines.length;

for (let i = startIndex + 1; i < lines.length; i += 1) {
  if (/^## \[/.test(lines[i])) {
    endIndex = i;
    break;
  }
}

const section = lines.slice(startIndex + 1, endIndex).join("\n").trim();

if (!section) {
  fail(`Changelog entry for version ${version} is empty.`);
}

process.stdout.write(`${section}\n`);
