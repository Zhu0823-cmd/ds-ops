import { randomUUID } from "node:crypto";

const PAGE_RESERVED_BYTES = 256;

type RecordValue = {
  createdAt: number;
  items: unknown[];
  bytes: number;
};

function sliceByBytes(text: string, charOffset: number, maxBytes: number) {
  const start = Math.max(0, Math.min(charOffset, text.length));
  let end = start;
  let bytes = 0;
  for (const character of text.slice(start)) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return {
    chunk: text.slice(start, end),
    nextCharOffset: end < text.length ? end : null
  };
}

export class ResultStore {
  private readonly records = new Map<string, RecordValue>();
  private totalBytes = 0;

  constructor(
    private readonly sessionId: string,
    private readonly ttlMs = 30 * 60_000,
    private readonly maxRecords = 64,
    private readonly maxBytes = 16 * 1024 * 1024
  ) {}

  put(value: unknown): string {
    const items = Array.isArray(value)
      ? value
      : Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : [value];
    const encoded = Buffer.byteLength(JSON.stringify(items));
    if (encoded > this.maxBytes) {
      throw new Error("result is too large for the bounded result store");
    }
    this.prune();
    while (
      this.records.size >= this.maxRecords ||
      this.totalBytes + encoded > this.maxBytes
    ) {
      const oldest = this.records.keys().next().value;
      if (!oldest) break;
      this.delete(oldest);
    }
    const ref = `opsref://${this.sessionId}/${randomUUID()}`;
    this.records.set(ref, { createdAt: Date.now(), items, bytes: encoded });
    this.totalBytes += encoded;
    return ref;
  }

  page(
    ref: string,
    offset = 0,
    limit = 32,
    maxBytes = 32768,
    charOffset = 0
  ) {
    if (!ref.startsWith(`opsref://${this.sessionId}/`)) {
      throw new Error("result reference not found");
    }
    const record = this.records.get(ref);
    if (!record) throw new Error("result reference not found");
    if (Date.now() - record.createdAt > this.ttlMs) {
      this.delete(ref);
      throw new Error("result reference expired");
    }
    const safeLimit = Math.max(1, Math.min(100, limit));
    const safeBytes = Math.max(1024, Math.min(65536, maxBytes));
    const items: unknown[] = [];
    let bytes = 0;
    let index = Math.max(0, offset);
    for (; index < record.items.length && items.length < safeLimit; index++) {
      const item = record.items[index];
      const encoded = Buffer.byteLength(JSON.stringify(item));
      const budget = safeBytes - PAGE_RESERVED_BYTES;
      if (items.length === 0 && encoded > budget) {
        return chunkedItem(record.items, index, charOffset, safeBytes);
      }
      const candidate = [...items, item];
      const candidatePage = {
        items: candidate,
        nextOffset: index + 1 < record.items.length ? index + 1 : null,
        total: record.items.length
      };
      if (Buffer.byteLength(JSON.stringify(candidatePage)) > safeBytes) {
        if (items.length === 0) {
          return chunkedItem(record.items, index, charOffset, safeBytes);
        }
        break;
      }
      if (bytes + encoded > budget) break;
      items.push(item);
      bytes += encoded;
    }
    return {
      items,
      nextOffset: index < record.items.length ? index : null,
      total: record.items.length
    };
  }

  private delete(ref: string): void {
    const record = this.records.get(ref);
    if (!record) return;
    this.totalBytes -= record.bytes;
    this.records.delete(ref);
  }

  private prune(): void {
    const now = Date.now();
    for (const [ref, record] of this.records) {
      if (now - record.createdAt > this.ttlMs) this.delete(ref);
    }
  }
}

function chunkedItem(
  items: unknown[],
  index: number,
  charOffset: number,
  maxBytes: number
) {
  const text = JSON.stringify(items[index]);
  const start = Math.max(0, Math.min(charOffset, text.length));
  const boundaries = [start];
  let offset = start;
  for (const character of text.slice(start)) {
    offset += character.length;
    boundaries.push(offset);
  }
  const responseAt = (end: number) => ({
    items: [],
    chunk: text.slice(start, end),
    itemIndex: index,
    nextOffset: end === text.length ? index + 1 : index,
    nextCharOffset: end === text.length ? null : end,
    total: items.length
  });
  let low = 0;
  let high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(JSON.stringify(responseAt(boundaries[middle]))) <= maxBytes
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const response = responseAt(boundaries[low]);
  if (Buffer.byteLength(JSON.stringify(response)) > maxBytes) {
    throw new Error("result page metadata exceeds maxBytes");
  }
  return response;
}
