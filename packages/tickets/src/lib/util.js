import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "yaml";
import { v7 as uuidv7, validate as uuidValidate, version as uuidVersion } from "uuid";

import { BASE_DIR } from "./constants.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function repoRoot() {
  return process.cwd();
}

export function packageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

export function ticketsDir() {
  return path.join(repoRoot(), ".tickets");
}

export function baseDir() {
  return path.join(repoRoot(), BASE_DIR);
}

export function nowUtc() {
  return new Date();
}

export function iso8601(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoBasic(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}T${hour}${minute}${second}.${ms}Z`;
}

export function parseIso(value) {
  if (typeof value !== "string") {
    return null;
  }
  const basicMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(value);
  const normalized = basicMatch
    ? `${basicMatch[1]}-${basicMatch[2]}-${basicMatch[3]}T${basicMatch[4]}:${basicMatch[5]}:${basicMatch[6]}${basicMatch[7] ?? ""}Z`
    : value;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? null : new Date(ts);
}

export function isUuidv7(value) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    return false;
  }
  return uuidValidate(value) && uuidVersion(value) === 7;
}

export function newUuidv7() {
  return uuidv7();
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readTemplate(relPath) {
  const filePath = path.join(packageRoot(), relPath);
  return fs.readFileSync(filePath, "utf8");
}

export function loadTicket(ticketPath) {
  const text = fs.readFileSync(ticketPath, "utf8");
  if (!text.startsWith("---")) {
    throw new Error("Missing front matter start '---'");
  }
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Malformed front matter");
  }
  const frontMatter = yaml.parse(match[1]) ?? {};
  if (typeof frontMatter !== "object" || frontMatter === null || Array.isArray(frontMatter)) {
    throw new Error("Front matter must be a mapping");
  }
  const body = match[2].replace(/^\n+/, "");
  return [frontMatter, body];
}

export function writeTicket(ticketPath, frontMatter, body) {
  const yamlText = yaml.stringify(frontMatter).trimEnd();
  const out = `---\n${yamlText}\n---\n${body.trimEnd()}\n`;
  fs.writeFileSync(ticketPath, out);
}

export function readJsonl(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    entries.push(JSON.parse(trimmed));
  }
  return entries;
}

export function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

export function listTicketDirs() {
  const root = ticketsDir();
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export function matchesRunFilename(name) {
  return /^[0-9T:.]+Z-[A-Za-z0-9_-]+\.jsonl$/.test(name);
}

export function resolveTicketPath(ticketRef) {
  const explicit = path.resolve(repoRoot(), ticketRef);
  if (fs.existsSync(explicit)) {
    if (fs.statSync(explicit).isDirectory()) {
      return path.join(explicit, "ticket.md");
    }
    return explicit;
  }
  const candidate = path.join(ticketsDir(), ticketRef, "ticket.md");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error(`Ticket not found: ${ticketRef}`);
}
