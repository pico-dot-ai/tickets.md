import fs from "node:fs";
import path from "node:path";

import yaml from "yaml";

import {
  DEFAULT_CLAIM_TTL_MINUTES,
  PLANNING_NODE_TYPES,
  WORKFLOW_MODE_VALUES,
} from "./constants.js";
import { packageRoot, repoRoot, ticketsDir } from "./util.js";

const DEFAULT_PROFILE_RELATIVE_PATH = path.join(".tickets", "spec", "profile", "defaults.yml");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(base[key])) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function defaultProfilePath() {
  return path.join(packageRoot(), DEFAULT_PROFILE_RELATIVE_PATH);
}

export function repoConfigPath(root = repoRoot()) {
  return path.join(root, ".tickets", "config.yml");
}

export function loadDefaultProfile() {
  return yaml.parse(fs.readFileSync(defaultProfilePath(), "utf8")) ?? {};
}

export function loadRepoConfig(root = repoRoot()) {
  const configPath = repoConfigPath(root);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const parsed = yaml.parse(fs.readFileSync(configPath, "utf8")) ?? {};
  if (!isObject(parsed)) {
    throw new Error("Repo config must be a mapping");
  }
  return parsed;
}

export function loadWorkflowProfile(root = repoRoot()) {
  return deepMerge(loadDefaultProfile(), loadRepoConfig(root));
}

export function buildInitialRepoConfig(profile = loadDefaultProfile()) {
  return {
    workflow: {
      mode: profile.workflow?.mode ?? "auto",
    },
    defaults: {
      planning: {
        node_type: profile.defaults?.planning?.node_type ?? "work",
        lane: profile.defaults?.planning?.lane ?? null,
        horizon: profile.defaults?.planning?.horizon ?? null,
      },
      claims: {
        ttl_minutes: profile.defaults?.claims?.ttl_minutes ?? DEFAULT_CLAIM_TTL_MINUTES,
      },
    },
    semantics: {
      terms: profile.semantics?.terms ?? {},
    },
    views: profile.views ?? {},
  };
}

export function renderRepoConfig(profile = loadDefaultProfile()) {
  const body = yaml.stringify(buildInitialRepoConfig(profile)).trimEnd();
  return [
    "# Repo-local @picoai/tickets overrides",
    "# This file is authoritative for local semantic mapping and defaults.",
    "# Safe to customize. `init --apply` will not overwrite it.",
    "",
    body,
    "",
  ].join("\n");
}

export function validateRepoConfig(root = repoRoot()) {
  const issues = [];
  const configPath = repoConfigPath(root);

  if (!fs.existsSync(configPath)) {
    return issues;
  }

  let config;
  try {
    config = loadRepoConfig(root);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "CONFIG_INVALID",
      message: String(error.message ?? error),
      config_path: configPath,
    });
    return issues;
  }

  const mode = config.workflow?.mode;
  if (mode !== undefined && !WORKFLOW_MODE_VALUES.includes(mode)) {
    issues.push({
      severity: "error",
      code: "CONFIG_WORKFLOW_MODE_INVALID",
      message: `workflow.mode must be one of ${WORKFLOW_MODE_VALUES.join(", ")}`,
      config_path: configPath,
    });
  }

  const nodeType = config.defaults?.planning?.node_type;
  if (nodeType !== undefined && !PLANNING_NODE_TYPES.includes(nodeType)) {
    issues.push({
      severity: "error",
      code: "CONFIG_DEFAULT_NODE_TYPE_INVALID",
      message: `defaults.planning.node_type must be one of ${PLANNING_NODE_TYPES.join(", ")}`,
      config_path: configPath,
    });
  }

  for (const key of ["lane", "horizon"]) {
    const value = config.defaults?.planning?.[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      issues.push({
        severity: "error",
        code: "CONFIG_DEFAULT_PLANNING_SCALAR_INVALID",
        message: `defaults.planning.${key} must be a string or null`,
        config_path: configPath,
      });
    }
  }

  const ttlMinutes = config.defaults?.claims?.ttl_minutes;
  if (ttlMinutes !== undefined && (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0)) {
    issues.push({
      severity: "error",
      code: "CONFIG_CLAIM_TTL_INVALID",
      message: "defaults.claims.ttl_minutes must be a positive integer",
      config_path: configPath,
    });
  }

  const terms = config.semantics?.terms;
  if (terms !== undefined && !isObject(terms)) {
    issues.push({
      severity: "error",
      code: "CONFIG_TERMS_INVALID",
      message: "semantics.terms must be a mapping",
      config_path: configPath,
    });
  }

  return issues;
}

export function ensureTicketsRoot(root = repoRoot()) {
  fs.mkdirSync(ticketsDir(), { recursive: true });
  fs.mkdirSync(path.dirname(repoConfigPath(root)), { recursive: true });
}
