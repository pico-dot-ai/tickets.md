import fs from "node:fs";
import path from "node:path";

import { CLAIM_ACTION_VALUES } from "./constants.js";
import { readJsonl } from "./util.js";

function claimEventsForLog(logPath) {
  return readJsonl(logPath)
    .filter((entry) => entry.event_type === "claim" && entry.claim && typeof entry.claim === "object")
    .map((entry) => ({ ...entry, log_path: logPath }));
}

export function loadClaimEvents(logsDir) {
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  return fs
    .readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(logsDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((logPath) => claimEventsForLog(logPath))
    .sort((a, b) => `${a.ts ?? ""}:${a.run_started ?? ""}`.localeCompare(`${b.ts ?? ""}:${b.run_started ?? ""}`));
}

export function deriveActiveClaim(entries, now = new Date()) {
  let active = null;

  for (const entry of entries) {
    const claim = entry.claim;
    if (!claim || !CLAIM_ACTION_VALUES.includes(claim.action)) {
      continue;
    }

    if (claim.action === "release") {
      if (active && (!claim.claim_id || claim.claim_id === active.claim_id)) {
        active = null;
      }
      continue;
    }

    active = {
      claim_id: claim.claim_id,
      action: claim.action,
      holder_id: claim.holder_id,
      holder_type: claim.holder_type,
      reason: claim.reason ?? "",
      ttl_minutes: claim.ttl_minutes,
      expires_at: claim.expires_at,
      supersedes_claim_id: claim.supersedes_claim_id ?? null,
      ts: entry.ts,
    };
  }

  if (!active) {
    return null;
  }

  const expiresAt = active.expires_at ? Date.parse(active.expires_at) : Number.NaN;
  if (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()) {
    return null;
  }

  return active;
}
