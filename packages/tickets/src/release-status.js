import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function packageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: packageRoot(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

export function summarizeReleaseStatus({
  packageName,
  currentVersion,
  headCommit,
  dirty,
  latestRelease,
}) {
  const messages = [];
  const publishedVersion = latestRelease?.version ?? "unknown";
  const publishedCommit = latestRelease?.commit ?? "unknown";
  const sameCommit = latestRelease ? headCommit === latestRelease.commit : false;
  const sameVersion = latestRelease ? currentVersion === latestRelease.version : false;

  if (!latestRelease) {
    messages.push("No published release is recorded yet.");
  } else if (sameCommit && sameVersion && !dirty) {
    messages.push("HEAD matches the latest recorded npm release.");
  } else {
    if (!sameCommit) {
      messages.push(`HEAD (${headCommit}) is ahead of the latest recorded release commit (${publishedCommit}).`);
    }
    if (!sameVersion) {
      messages.push(
        `Package version (${currentVersion}) differs from the latest recorded release version (${publishedVersion}).`,
      );
    } else if (!sameCommit) {
      messages.push("Package version has not changed since the latest recorded npm release.");
    }
    if (dirty) {
      messages.push("Working tree has uncommitted changes.");
    }
  }

  let recommendation;
  if (!latestRelease) {
    recommendation = "Record the first published release after npm publish.";
  } else if (dirty) {
    recommendation = "Commit or discard local changes before deciding whether to publish.";
  } else if (!sameCommit && sameVersion) {
    recommendation = "If this work should ship, bump the package version before publishing.";
  } else if (!sameCommit && !sameVersion) {
    recommendation = "If tests and docs are ready, HEAD is a plausible publish candidate.";
  } else {
    recommendation = "No publish action is indicated by release provenance alone.";
  }

  return {
    packageName,
    currentVersion,
    headCommit,
    dirty,
    latestRelease,
    messages,
    recommendation,
  };
}

export function loadReleaseStatus() {
  const root = packageRoot();
  const packageJson = readJson(path.join(root, "package.json"));
  const history = readJson(path.join(root, "release-history.json"));
  const releases = Array.isArray(history.releases) ? history.releases : [];
  const latestRelease = releases.length > 0 ? releases[releases.length - 1] : null;
  const headCommit = runGit(["rev-parse", "--short", "HEAD"]);
  const dirty = runGit(["status", "--short"]).length > 0;

  return summarizeReleaseStatus({
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    headCommit,
    dirty,
    latestRelease,
  });
}

export function formatReleaseStatus(status) {
  const lines = [
    `Package: ${status.packageName}`,
    `Current version: ${status.currentVersion}`,
    `Current HEAD: ${status.headCommit}`,
    `Working tree dirty: ${status.dirty ? "yes" : "no"}`,
  ];

  if (status.latestRelease) {
    lines.push(`Latest recorded npm release: ${status.latestRelease.version}`);
    lines.push(`Latest recorded release commit: ${status.latestRelease.commit}`);
    if (status.latestRelease.date) {
      lines.push(`Latest recorded release date: ${status.latestRelease.date}`);
    }
  } else {
    lines.push("Latest recorded npm release: none");
  }

  lines.push("");
  lines.push("Status:");
  for (const message of status.messages) {
    lines.push(`- ${message}`);
  }
  lines.push(`- Recommendation: ${status.recommendation}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  try {
    const status = loadReleaseStatus();
    process.stdout.write(formatReleaseStatus(status));
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
