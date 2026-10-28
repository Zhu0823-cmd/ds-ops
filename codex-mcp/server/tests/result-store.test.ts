import assert from "node:assert/strict";
import test from "node:test";
import { ResultStore } from "../src/result-store.js";

test("stores and pages a bounded result", () => {
  const store = new ResultStore("session-a", 60_000);
  const ref = store.put({ items: Array.from({ length: 20 }, (_, i) => ({ i })) });
  const page = store.page(ref, 0, 5, 4096);
  assert.equal(page.items.length, 5);
  assert.equal(page.nextOffset, 5);
});

test("does not read a reference from another session", () => {
  const first = new ResultStore("session-a", 60_000);
  const second = new ResultStore("session-b", 60_000);
  const ref = first.put({ value: 1 });
  assert.throws(() => second.page(ref, 0, 1, 4096), /not found|expired/i);
});

test("rejects a forged session prefix", () => {
  const store = new ResultStore("session-a", 60_000);
  store.put({ value: 1 });
  assert.throws(
    () => store.page("opsref://session-b/missing", 0, 1, 4096),
    /not found|expired/i
  );
});

test("evicts old references when the bounded store is full", () => {
  const store = new ResultStore("session-a", 60_000, 2);
  const first = store.put({ value: 1 });
  store.put({ value: 2 });
  store.put({ value: 3 });
  assert.throws(() => store.page(first, 0, 1, 4096), /not found|expired/i);
});

test("chunks one oversized item without exceeding the byte budget", () => {
  const store = new ResultStore("session-a", 60_000);
  const text = "中".repeat(400);
  const ref = store.put({ items: [{ text }] });
  const first = store.page(ref, 0, 1, 1024, 0);
  assert.equal(first.items.length, 0);
  assert.ok(first.chunk && Buffer.byteLength(first.chunk) <= 1024);
  assert.equal(first.nextOffset, 0);
  const second = store.page(ref, 0, 1, 1024, first.nextCharOffset);
  assert.ok(second.chunk);
});

test("keeps the complete serialized page within maxBytes", () => {
  const store = new ResultStore("session-a", 60_000);
  const ref = store.put({
    items: Array.from({ length: 20 }, () => ({
      text: "\"中\\".repeat(80)
    }))
  });
  for (let offset = 0, charOffset = 0, attempts = 0; offset < 20; attempts++) {
    assert.ok(attempts < 1000, `pagination stalled at offset ${offset}`);
    const page = store.page(ref, offset, 20, 1024, charOffset);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024);
    if (typeof page.nextCharOffset === "number") {
      charOffset = page.nextCharOffset;
    } else {
      offset = page.nextOffset ?? 20;
      charOffset = 0;
    }
  }
});

test("expires references", async () => {
  const store = new ResultStore("session-a", 1);
  const ref = store.put({ value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.throws(() => store.page(ref, 0, 1, 4096), /expired/i);
});
