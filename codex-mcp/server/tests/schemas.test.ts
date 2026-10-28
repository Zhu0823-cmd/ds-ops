import assert from "node:assert/strict";
import test from "node:test";
import { readFilesInput, resultInput, searchInput } from "../src/schemas.js";

test("accepts a bounded multi-file read", () => {
  const input = readFilesInput.parse({
    files: [{ path: "a.ts" }, { path: "b.ts", offset: 2, limit: 10 }]
  });
  assert.equal(input.files.length, 2);
  assert.equal(input.files[0].offset, 1);
});

test("rejects unknown file fields", () => {
  assert.throws(() =>
    readFilesInput.parse({ files: [{ path: "a.ts", absolute: true }] })
  );
});

test("rejects search without a supported mode", () => {
  assert.throws(() => searchInput.parse({ mode: "regex-all", pattern: "x" }));
});

test("accepts a character offset for oversized result chunks", () => {
  const input = resultInput.parse({
    ref: "opsref://session/id",
    charOffset: 128
  });
  assert.equal(input.charOffset, 128);
});
