import fs from "node:fs";
import path from "node:path";

import { buildInitialRepoConfig, loadDefaultProfile, renderRepoConfig, repoConfigPath } from "./config.js";
import { ensureDir, repoRoot } from "./util.js";

function renderSemanticTerms(profile) {
  const terms = profile.semantics?.terms ?? {};
  return Object.entries(terms)
    .map(([name, mapping]) => {
      const field = mapping.field ?? "custom";
      const suffix = mapping.value ? ` = \`${mapping.value}\`` : "";
      const description = mapping.description ? ` ${mapping.description}` : "";
      return `- \`${name}\` -> \`${field}\`${suffix}.${description}`.replace(/\.\s+\./g, ".");
    })
    .join("\n");
}

export function repoSkillPath(root = repoRoot()) {
  return path.join(root, ".tickets", "skills", "tickets", "SKILL.md");
}

export function renderRepoSkill(profile = loadDefaultProfile()) {
  const config = buildInitialRepoConfig(profile);
  return [
    "# tickets",
    "",
    "This repo skill mirrors the canonical ticketing workflow in `TICKETS.md`.",
    "Use it when your environment supports repo-local skills. In all cases, use `npx @picoai/tickets` as the only state-changing interface.",
    "",
    "## Required behavior",
    "- Read `TICKETS.md` for the full repo contract when context is missing.",
    "- Consult `.tickets/config.yml` for repo-local defaults and semantic overrides before interpreting planning terminology or creating new tickets.",
    "- Validate assigned tickets before implementation with `npx @picoai/tickets validate`.",
    "- Use `npx @picoai/tickets status`, `log`, `claim`, `plan`, and `graph` instead of editing derived state manually.",
    "- When humans use terms like feature, phase, milestone, roadmap, or repo-specific equivalents, translate them through `.tickets/config.yml` and then call the generic CLI fields.",
    "- Respect repo overrides in `.tickets/config.yml` and any narrative guidance in `TICKETS.override.md` if present.",
    "",
    "## Core planning model",
    "- `planning.node_type`: `work`, `group`, or `checkpoint`.",
    "- `planning.group_ids`: group membership edges.",
    "- `planning.precedes`: sequencing edges, separate from hard `dependencies`.",
    "- `planning.lane`, `planning.rank`, and `planning.horizon`: generic ordering and roadmap dimensions.",
    "- `resolution`: terminal work outcome (`completed`, `merged`, `dropped`).",
    "",
    "## Default semantic mapping",
    renderSemanticTerms(config),
    "",
    "Repo-specific semantic overrides live in `.tickets/config.yml`. Treat the list above as defaults only.",
    "",
    "## Claims",
    "- Claims are optional advisory leases stored in ticket logs.",
    "- Acquire or renew with `npx @picoai/tickets claim --ticket <id>`.",
    "- Release with `npx @picoai/tickets claim --ticket <id> --release`.",
    `- Default claim TTL is ${config.defaults?.claims?.ttl_minutes ?? 60} minutes unless the repo config overrides it.`,
    "",
    "## Planning views",
    "- Use `npx @picoai/tickets list` for broad queue/reporting views.",
    "- Use `npx @picoai/tickets plan` for operational state: ready, in-progress, blocked, and group rollups.",
    "- Use `npx @picoai/tickets graph` for structural relationships, not execution state.",
    "",
  ].join("\n");
}

export function syncRepoConfig(root = repoRoot()) {
  const configPath = repoConfigPath(root);
  ensureDir(path.dirname(configPath));
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, renderRepoConfig(loadDefaultProfile()));
  }
}

export function syncRepoSkill(root = repoRoot(), apply = false) {
  const skillPath = repoSkillPath(root);
  ensureDir(path.dirname(skillPath));
  if (apply || !fs.existsSync(skillPath)) {
    fs.writeFileSync(skillPath, renderRepoSkill(loadDefaultProfile()));
  }
}
