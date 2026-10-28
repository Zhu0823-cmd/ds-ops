#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { ResultStore } from "./result-store.js";
import { readFilesInput, resultInput, searchInput } from "./schemas.js";
import { WorkerClient } from "./worker-client.js";

const workspace = process.env.DSH_OPS_WORKSPACE;
const workerPath = process.env.DSH_OPS_WORKER_PATH;
if (!workspace || !workerPath) {
  throw new Error("DSH_OPS_WORKSPACE and DSH_OPS_WORKER_PATH are required");
}

const scope = randomUUID();
const store = new ResultStore(scope);
const worker = new WorkerClient({ workspace, workerPath, scope });
const server = new McpServer({ name: "dsh-ops-codex", version: "0.1.0" });

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }]
  };
}

function bounded(value: Record<string, unknown>, maxBytes: number) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) <= maxBytes) {
    return text(value);
  }

  const ref = store.put(value);
  const total = Array.isArray(value.items) ? value.items.length : null;
  const summary: Record<string, unknown> = {
    truncated: true,
    nextRef: ref,
    total,
    message:
      "Result exceeded maxBytes. Use ops_result with nextRef for returned items. If nextIndex or continuation is present, continue the original operation with those values."
  };
  const continuationKeys = [
    "status",
    "complete",
    "nextIndex",
    "pending",
    "nextOffset",
    "continuation",
    "truncatedBy",
    "nextAction",
    "error"
  ];
  for (const key of continuationKeys) {
    if (!(key in value)) continue;
    const candidate = { ...summary, [key]: value[key] };
    if (Buffer.byteLength(JSON.stringify(candidate)) <= maxBytes) {
      summary[key] = value[key];
    }
  }
  return text(summary);
}

server.registerTool(
  "ops_read_files",
  {
    title: "Read workspace files",
    description: "Read 1-32 bounded UTF-8 file ranges in one call.",
    inputSchema: readFilesInput.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (input) => {
    const value = readFilesInput.parse(input);
    return bounded(await worker.readFiles(value.files), value.maxBytes);
  }
);

server.registerTool(
  "ops_search",
  {
    title: "Search workspace",
    description: "Search files or content under the workspace with bounded output.",
    inputSchema: searchInput.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (input) => {
    const value = searchInput.parse(input);
    return bounded(await worker.search(value), value.maxBytes);
  }
);

server.registerTool(
  "ops_result",
  {
    title: "Page bounded result",
    description:
      "Page an opsref:// result returned by ops_read_files or ops_search.",
    inputSchema: resultInput.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (input) => {
    const value = resultInput.parse(input);
    return text(
      store.page(
        value.ref,
        value.offset,
        value.limit,
        value.maxBytes,
        value.charOffset
      )
    );
  }
);

await server.connect(new StdioServerTransport());
