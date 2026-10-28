import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

function textResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content[0];
  assert.equal(content.type, "text");
  return JSON.parse(content.text) as Record<string, unknown>;
}

test("serves the bounded read-only MCP contract", async (t) => {
  const workerPath = process.env.DSH_OPS_WORKER_PATH;
  assert.ok(workerPath, "DSH_OPS_WORKER_PATH must be set");
  const root = await mkdtemp(path.join(tmpdir(), "ops-mcp-"));
  const workspace = path.join(root, "workspace");
  const configPath = path.join(root, "config.json");
  await mkdir(workspace);
  await mkdir(path.join(workspace, ".tmp-credentials"));
  await writeFile(path.join(workspace, "alpha.txt"), "alpha\n");
  await writeFile(
    path.join(workspace, ".tmp-credentials", ".env"),
    "SENTINEL_SECRET=must-not-return\n"
  );
  await writeFile(
    path.join(workspace, "large.txt"),
    Array.from({ length: 120 }, (_, index) => `line ${index}: ${"x".repeat(80)}`).join("\n")
  );
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
  const client = new Client({ name: "ops-test", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ["ops_read_files", "ops_result", "ops_search"]
  );

  const read = textResult(
    await client.callTool({
      name: "ops_read_files",
      arguments: {
        files: [{ path: "alpha.txt" }],
        maxBytes: 1024
      }
    })
  );
  assert.equal(read.status, "completed");
  assert.ok(Array.isArray(read.items));

  const found = textResult(
    await client.callTool({
      name: "ops_search",
      arguments: {
        mode: "files",
        pattern: "*.txt",
        maxResults: 1,
        maxBytes: 4096
      }
    })
  );
  assert.equal(found.status, "completed");
  assert.ok(Array.isArray(found.items));
  assert.equal(found.items.length, 1);
  assert.equal(typeof found.continuation, "string");

  const nextSearch = textResult(
    await client.callTool({
      name: "ops_search",
      arguments: {
        mode: "files",
        pattern: "*.txt",
        maxResults: 1,
        offset: found.nextOffset,
        continuation: found.continuation,
        maxBytes: 4096
      }
    })
  );
  assert.ok(Array.isArray(nextSearch.items));
  assert.equal(nextSearch.items.length, 1);

  const deniedCredential = await client.callTool({
    name: "ops_read_files",
    arguments: {
      files: [{ path: ".tmp-credentials/.env" }],
      maxBytes: 1024
    }
  });
  assert.equal(deniedCredential.isError, true);
  assert.ok(
    deniedCredential.content.every(
      (item) => item.type !== "text" || !item.text.includes("SENTINEL_SECRET")
    )
  );

  const deniedEscape = await client.callTool({
    name: "ops_read_files",
    arguments: {
      files: [{ path: "../outside-secret.txt" }],
      maxBytes: 1024
    }
  });
  assert.equal(deniedEscape.isError, true);

  const large = textResult(
    await client.callTool({
      name: "ops_read_files",
      arguments: {
        files: [{ path: "large.txt", limit: 120 }],
        maxBytes: 1024
      }
    })
  );
  assert.equal(large.truncated, true);
  assert.equal(typeof large.nextRef, "string");

  const page = textResult(
    await client.callTool({
      name: "ops_result",
      arguments: {
        ref: large.nextRef,
        maxBytes: 1024
      }
    })
  );
  assert.equal(typeof page.chunk, "string");
  assert.equal(typeof page.nextCharOffset, "number");

  const nextPage = textResult(
    await client.callTool({
      name: "ops_result",
      arguments: {
        ref: large.nextRef,
        charOffset: page.nextCharOffset,
        maxBytes: 1024
      }
    })
  );
  assert.equal(typeof nextPage.chunk, "string");
});
