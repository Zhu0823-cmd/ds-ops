import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPathPolicy } from "../src/paths.js";

test("resolves a normal workspace file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  await writeFile(path.join(root, "note.txt"), "hello");
  const policy = await createPathPolicy(root);
  assert.equal(await policy.resolveRead("note.txt"), path.join(root, "note.txt"));
});

test("rejects paths outside the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  const policy = await createPathPolicy(root);
  await assert.rejects(() => policy.resolveRead("..\\outside.txt"), /workspace/i);
});

test("rejects credential files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  await writeFile(path.join(root, ".env"), "SECRET=1");
  const policy = await createPathPolicy(root);
  await assert.rejects(() => policy.resolveRead(".env"), /credential/i);
});

test("rejects credential directories case-insensitively", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  await mkdir(path.join(root, ".SSH"));
  await writeFile(path.join(root, ".SSH", "id_rsa"), "SECRET=1");
  const policy = await createPathPolicy(root);
  await assert.rejects(() => policy.resolveRead(".SSH/id_rsa"), /credential/i);
});

test("rejects a symlink that escapes the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ops-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "outside");
  await mkdir(path.join(root, "links"));
  await symlink(outside, path.join(root, "links", "escape"), "junction");
  const policy = await createPathPolicy(root);
  await assert.rejects(() => policy.resolveRead("links\\escape\\secret.txt"), /workspace|link/i);
});
