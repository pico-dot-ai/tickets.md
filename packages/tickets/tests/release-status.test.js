import test from "node:test";
import assert from "node:assert/strict";

import { summarizeReleaseStatus } from "../src/release-status.js";

test("release status reports unchanged published head", () => {
  const status = summarizeReleaseStatus({
    packageName: "@picoai/tickets",
    currentVersion: "0.1.0",
    headCommit: "74b0378",
    dirty: false,
    latestRelease: {
      version: "0.1.0",
      commit: "74b0378",
      date: "2026-03-11",
    },
  });

  assert.match(status.messages[0], /matches the latest recorded npm release/);
  assert.match(status.recommendation, /No publish action/);
});

test("release status warns when commit is ahead but version is unchanged", () => {
  const status = summarizeReleaseStatus({
    packageName: "@picoai/tickets",
    currentVersion: "0.1.0",
    headCommit: "abc1234",
    dirty: false,
    latestRelease: {
      version: "0.1.0",
      commit: "74b0378",
      date: "2026-03-11",
    },
  });

  assert.equal(status.messages.some((message) => /ahead of the latest recorded release commit/.test(message)), true);
  assert.equal(status.messages.some((message) => /version has not changed/.test(message)), true);
  assert.match(status.recommendation, /bump the package version/);
});

test("release status marks bumped version as plausible publish candidate", () => {
  const status = summarizeReleaseStatus({
    packageName: "@picoai/tickets",
    currentVersion: "0.2.0",
    headCommit: "abc1234",
    dirty: false,
    latestRelease: {
      version: "0.1.0",
      commit: "74b0378",
      date: "2026-03-11",
    },
  });

  assert.equal(status.messages.some((message) => /differs from the latest recorded release version/.test(message)), true);
  assert.match(status.recommendation, /plausible publish candidate/);
});

test("release status warns about dirty working tree", () => {
  const status = summarizeReleaseStatus({
    packageName: "@picoai/tickets",
    currentVersion: "0.2.0",
    headCommit: "abc1234",
    dirty: true,
    latestRelease: {
      version: "0.1.0",
      commit: "74b0378",
      date: "2026-03-11",
    },
  });

  assert.equal(status.messages.some((message) => /Working tree has uncommitted changes/.test(message)), true);
  assert.match(status.recommendation, /Commit or discard local changes/);
});
