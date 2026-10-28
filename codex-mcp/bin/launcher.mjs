#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const configPath =
  process.env.DSH_OPS_CONFIG ??
  path.join(homedir(), ".dsh-ops-codex", "config.json");

function loadConfig() {
  if (!existsSync(configPath)) return {};
  const value = JSON.parse(readFileSync(configPath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid config object in ${configPath}`);
  }
  return value;
}

const config = loadConfig();
const configDirectory = path.dirname(configPath);
const workspaceFromEnvironment = process.env.DSH_OPS_WORKSPACE !== undefined;
const workerFromEnvironment = process.env.DSH_OPS_WORKER_PATH !== undefined;
const workspaceValue = workspaceFromEnvironment
  ? process.env.DSH_OPS_WORKSPACE
  : config.workspace;
const workerValue = workerFromEnvironment
  ? process.env.DSH_OPS_WORKER_PATH
  : config.workerPath;
if (
  typeof workspaceValue !== "string" ||
  workspaceValue.length === 0 ||
  typeof workerValue !== "string" ||
  workerValue.length === 0
) {
  throw new Error(`Missing workspace or worker path in ${configPath}`);
}

const workspace =
  workspaceFromEnvironment
    ? path.resolve(workspaceValue)
    : path.resolve(configDirectory, workspaceValue);
const worker =
  workerFromEnvironment
    ? path.resolve(workerValue)
    : path.resolve(configDirectory, workerValue);

const child = spawn(
  process.execPath,
  [path.join(root, "server", "dist", "index.mjs")],
  {
    env: {
      ...process.env,
      DSH_OPS_WORKSPACE: workspace,
      DSH_OPS_WORKER_PATH: worker
    },
    stdio: "inherit",
    windowsHide: true
  }
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
