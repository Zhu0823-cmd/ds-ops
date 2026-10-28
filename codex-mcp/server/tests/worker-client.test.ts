import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkerClient } from "../src/worker-client.js";

test("invokes the native worker and parses JSON", async () => {
  const workerPath = process.env.DSH_OPS_WORKER_PATH;
  assert.ok(workerPath, "DSH_OPS_WORKER_PATH must be set");
  const root = await mkdtemp(path.join(tmpdir(), "ops-worker-"));
  await writeFile(path.join(root, "hello.txt"), "hello\n");
  await writeFile(path.join(root, "other.txt"), "other\n");

  const client = new WorkerClient({
    workerPath,
    workspace: root,
    scope: "test-session"
  });

  const result = await client.readFiles([
    { path: "hello.txt", offset: 1, limit: 10 },
    { path: "other.txt", offset: 1, limit: 10 },
    { path: "missing.txt", offset: 1, limit: 10 }
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.items.length, 3);
  assert.equal(
    (result.items[2] as { status?: string }).status,
    "error"
  );

  const found = await client.search({
    mode: "files",
    pattern: "*.txt",
    path: ".",
    maxResults: 10
  });
  assert.equal(found.status, "completed");
  assert.equal(found.items.length, 2);

  const firstPage = await client.search({
    mode: "files",
    pattern: "*.txt",
    path: ".",
    maxResults: 1
  });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.nextOffset, 1);
  assert.equal(typeof firstPage.continuation, "string");

  const secondPage = await client.search({
    mode: "files",
    pattern: "*.txt",
    path: ".",
    maxResults: 1,
    offset: 1,
    continuation: firstPage.continuation as string
  });
  assert.equal(secondPage.items.length, 1);
  assert.notDeepEqual(secondPage.items, firstPage.items);
});
