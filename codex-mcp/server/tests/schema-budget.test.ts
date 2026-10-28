import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getEncoding } from "js-tiktoken";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

function inheritedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      entry[1] !== undefined
    )
  );
}

test("keeps fixed tool schemas and normal payloads within budget", async (t) => {
  const workerPath = process.env.DSH_OPS_WORKER_PATH;
  assert.ok(workerPath, "DSH_OPS_WORKER_PATH must be set");
  const root = await mkdtemp(path.join(tmpdir(), "ops-schema-"));
  const workspace = path.join(root, "workspace");
  const configPath = path.join(root, "config.json");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "small.txt"), "small result\n");
  await writeFile(
    configPath,
    JSON.stringify({
      workspace: "workspace",
      workerPath: path.relative(root, workerPath)
    })
  );

  const env = inheritedEnvironment();
  delete env.DSH_OPS_WORKSPACE;
  delete env.DSH_OPS_WORKER_PATH;
  env.DSH_OPS_CONFIG = configPath;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "bin", "launcher.mjs")],
    env,
    stderr: "pipe"
  });
  const client = new Client({ name: "schema-budget", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  await client.connect(transport);
  const listed = await client.listTools();
  const encoding = getEncoding("cl100k_base");
  const tokens = encoding.encode(JSON.stringify(listed.tools)).length;
  t.diagnostic(`three tool schemas use ${tokens} cl100k_base tokens`);
  assert.ok(tokens <= 700, `tool schemas used ${tokens} tokens`);

  const read = await client.callTool({
    name: "ops_read_files",
    arguments: {
      files: [{ path: "small.txt" }],
      maxBytes: 4096
    }
  });
  assert.equal(read.content[0].type, "text");
  assert.ok(Buffer.byteLength(read.content[0].text) <= 64 * 1024);

  const search = await client.callTool({
    name: "ops_search",
    arguments: {
      mode: "content",
      pattern: "small",
      maxResults: 10,
      maxBytes: 4096
    }
  });
  assert.equal(search.content[0].type, "text");
  assert.ok(Buffer.byteLength(search.content[0].text) <= 64 * 1024);
});
