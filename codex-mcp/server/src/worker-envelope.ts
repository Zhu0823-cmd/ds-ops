import { randomUUID } from "node:crypto";

export const WORKER_TIMEOUT_MS = 30_000;
export const WORKER_OUTPUT_BYTES = 128 * 1024;

export function workerEnvelope(
  request: Record<string, unknown>,
  timeoutMs = WORKER_TIMEOUT_MS
) {
  return {
    version: 1,
    requestId: randomUUID(),
    component: "file",
    budget: {
      timeoutMs: Math.max(1, Math.min(timeoutMs, WORKER_TIMEOUT_MS)),
      maxBytes: WORKER_OUTPUT_BYTES
    },
    request
  };
}
