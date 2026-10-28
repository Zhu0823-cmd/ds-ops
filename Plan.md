# DSH Ops Codex MCP Read-Only Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows x64 Codex MCP adapter that exposes a small read-only subset of `dsh-ops` without replacing Codex built-in tools.

**Architecture:** Keep the existing DSH plugin intact and add an isolated `codex-mcp/` package. The new MCP server validates workspace and path policy, invokes the existing Rust worker through its one-shot JSON protocol, stores oversized output behind bounded result references, and exposes only `ops_read_files`, `ops_search`, and `ops_result`.

**Tech Stack:** TypeScript, Node.js 24, `@modelcontextprotocol/sdk`, Zod, the Rust `dsh-ops-worker`, Node's built-in test runner, Codex `.mcp.json`, Codex plugin manifest, and a lightweight Codex Skill.

---

## Review Corrections

This plan incorporates four corrections found during review:

1. The MCP server never trusts a model-supplied workspace root. It requires a root from the server environment or the installer-written user config; otherwise it fails closed.
2. Result paging is part of the first release. `ops_result` is required because read and search output must be bounded.
3. DSH duplicate-read suppression is not ported. It depends on DSH message IDs and stream events and has no equivalent in the MCP server.
4. Plugin packaging is a separate validation step after the standalone MCP server works with Codex Desktop and DeepSeek.

## Fixed Baselines

- Fork directory: `D:\Users\Documents\GitHub\ds-ops`
- Fork remote: `https://github.com/Zhu0823-cmd/ds-ops.git`
- Upstream remote: `https://github.com/T-Auto/dsh-ops.git`
- Pinned source commit: `a9174ac3257f15118b5a4683b20ca64529ddadda`
- Target host: Codex Desktop using the existing DeepSeek custom provider
- Target platform: Windows x64
- Node baseline: `v24.16.0`
- Rust toolchain: `cargo` and `rustc` are present; the crate requires Rust 1.88, and MSVC linking must be verified before implementation
- Native worker output: `native/target/release/dsh-ops-worker.exe`
- DSH plugin code remains available but is not registered in Codex
- First release is read-only

## Non-Goals

- Do not replace Codex built-in `read`, `glob`, or `grep`.
- Do not port DSH profile, component, ToolRuntime, TUI, or progressive tool publication.
- Do not port `ops_bash` or any Windows Bash payload.
- Do not port write, edit, copy, move, remove, or batch mutation tools in the first release.
- Do not add PDF, DOCX, or CSV readers until the first three tools pass integration and token gates.
- Do not use the model process to choose an unrestricted workspace root.
- Do not cache or suppress file bodies as DSH does.

## Public Tool Contract

The MCP server exposes exactly three tools.

### `ops_read_files`

Input:

```json
{
  "files": [
    { "path": "src/index.ts", "offset": 1, "limit": 120 },
    { "path": "README.md", "offset": 20, "limit": 80 }
  ],
  "maxBytes": 32768
}
```

Rules:

- `files` contains 1 to 32 items.
- `offset` is 1-based and defaults to 1.
- `limit` is 1 to 10000 and defaults to 200.
- Paths resolve relative to the verified workspace root.
- The result is bounded to a maximum of 64 KiB.
- If the full result does not fit, store it behind an `opsref://` identifier and return `nextRef`.

### `ops_search`

Input:

```json
{
  "mode": "content",
  "pattern": "createRunCodeTool",
  "path": ".",
  "maxResults": 50,
  "maxBytes": 32768
}
```

Rules:

- `mode` is exactly `files` or `content`.
- `files` mode treats `pattern` as a glob.
- `content` mode treats `pattern` as a regular expression.
- `path` is a relative path under the verified workspace root.
- `maxResults` is 1 to 200 and defaults to 50.
- Hidden files, `.git`, credential directories, symlinks, junctions, and reparse points are excluded.
- Oversized results are stored behind `opsref://` and returned as `nextRef`.

### `ops_result`

Input:

```json
{
  "ref": "opsref://4b5b508a-0f17-4d20-9a69-5869fce4e9cd",
  "offset": 0,
  "limit": 32,
  "maxBytes": 32768
}
```

Rules:

- References are session-scoped and expire 30 minutes after creation.
- References cannot be used across MCP server restarts.
- `offset` is a zero-based page offset.
- Pages are bounded by `maxBytes` and a hard 64 KiB cap.

## File Map

Create a new isolated package:

```text
codex-mcp/
|-- .agents/
|   `-- plugins/
|       `-- marketplace.json
|-- .codex-plugin/
|   `-- plugin.json
|-- .mcp.json
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- bin/
|   `-- launcher.mjs
|-- server/
|   |-- src/
|   |   |-- index.ts
|   |   |-- paths.ts
|   |   |-- result-store.ts
|   |   |-- schemas.ts
|   |   |-- worker-client.ts
|   |   `-- worker-envelope.ts
|   |-- tests/
|   |   |-- paths.test.ts
|   |   |-- result-store.test.ts
|   |   |-- schemas.test.ts
|   |   `-- worker-client.test.ts
|   `-- dist/
`-- skills/
    `-- dsh-ops-codex/
        `-- SKILL.md
```

Keep the upstream `src/adapter/dsh/` untouched. The new package imports only the portable worker envelope shape and calls the compiled Rust worker over stdio.

## Task 0: Verify Build Prerequisites

**Files:**
- Read: `native/Cargo.toml`
- Read: `package.json`

This is a configuration/environment gate, so no production code is written.

- [ ] **Step 1: Confirm the fork is clean and create the feature branch**

Run:

```powershell
git -c safe.directory=* status --short --branch
git -c safe.directory=* switch -c feature/codex-mcp-readonly
```

Expected:

- The initial status is `## main...origin/main` with no modified files
- The new branch is `feature/codex-mcp-readonly`

- [ ] **Step 2: Confirm the Rust target and linker**

Run:

```powershell
rustc -vV
cargo metadata --manifest-path native/Cargo.toml --format-version 1
```

Expected:

- `host` contains `x86_64-pc-windows-msvc`
- Cargo resolves all native workspace crates
- No missing-linker error

- [ ] **Step 3: Build the existing worker**

Run:

```powershell
cargo build --manifest-path native/Cargo.toml --release
```

Expected:

- Exit code `0`
- A Windows worker executable exists under `native/target/release/`

- [ ] **Step 4: Record the worker path**

Run:

```powershell
Get-ChildItem native\target\release -Filter '*.exe' |
  Select-Object Name,Length
```

Expected:

- `dsh-ops-worker.exe` is present
- The exact filename is recorded in `codex-mcp/server/src/worker-client.ts`

## Task 1: Add a Failing Policy Test

**Files:**
- Create: `codex-mcp/package.json`
- Create: `codex-mcp/tsconfig.json`
- Modify: `.gitignore`
- Create: `codex-mcp/server/tests/paths.test.ts`
- Create after RED: `codex-mcp/server/src/paths.ts`

- [ ] **Step 1: Create the package metadata**

`codex-mcp/package.json`:

```json
{
  "name": "@dsh-ops/codex-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.19"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "npm run typecheck && esbuild server/src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=server/dist/index.mjs",
    "test": "node --test --import tsx server/tests/*.test.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "esbuild": "^0.25.0",
    "tsx": "^4.20.0",
    "typescript": "^6.0.0"
  }
}
```

`codex-mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "rootDir": "server/src",
    "types": ["node"]
  },
  "include": ["server/src/**/*.ts"]
}
```

- [ ] **Step 2: Ignore generated dependencies and output**

Append to `.gitignore`:

```text
codex-mcp/node_modules/
codex-mcp/server/dist/
```

- [ ] **Step 3: Write the failing path-policy tests**

`codex-mcp/server/tests/paths.test.ts`:

```typescript
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

test("rejects a symlink that escapes the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-policy-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ops-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "outside");
  await mkdir(path.join(root, "links"));
  await symlink(outside, path.join(root, "links", "escape"), "junction");
  const policy = await createPathPolicy(root);
  await assert.rejects(() => policy.resolveRead("links\\escape\\secret.txt"), /workspace|link/i);
});
```

- [ ] **Step 4: Run the tests to verify RED**

Run:

```powershell
npm test --prefix codex-mcp
```

Expected:

- FAIL because `../src/paths.js` does not exist

## Task 2: Implement Workspace and Credential Policy

**Files:**
- Create: `codex-mcp/server/src/paths.ts`
- Test: `codex-mcp/server/tests/paths.test.ts`

- [ ] **Step 1: Implement the smallest policy that passes**

`codex-mcp/server/src/paths.ts`:

```typescript
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const CREDENTIAL_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519",
  ".netrc",
  ".npmrc",
  ".pypirc"
]);

const CREDENTIAL_DIRS = new Set([".ssh", ".aws", ".azure", ".gnupg"]);

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isCredential(relative: string): boolean {
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => CREDENTIAL_DIRS.has(part))) return true;
  const base = parts.at(-1)?.toLowerCase() ?? "";
  if (CREDENTIAL_NAMES.has(base)) return true;
  return base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".pfx");
}

export async function createPathPolicy(workspace: string) {
  const root = await realpath(path.resolve(workspace));

  async function resolveRead(input: string): Promise<string> {
    if (!input || path.isAbsolute(input)) {
      throw new Error("path must be relative to the workspace");
    }
    const candidate = path.resolve(root, input);
    if (!inside(root, candidate)) {
      throw new Error("path escapes the workspace");
    }
    const relative = path.relative(root, candidate);
    if (isCredential(relative)) {
      throw new Error("credential paths are not readable");
    }
    const resolvedParent = await realpath(path.dirname(candidate));
    if (!inside(root, resolvedParent)) {
      throw new Error("resolved parent escapes the workspace or crosses a link");
    }
    return path.join(resolvedParent, path.basename(candidate));
  }

  async function resolveDirectory(input: string): Promise<string> {
    if (!input || path.isAbsolute(input)) {
      throw new Error("path must be relative to the workspace");
    }
    const candidate = path.resolve(root, input);
    if (!inside(root, candidate)) {
      throw new Error("path escapes the workspace");
    }
    const resolved = await realpath(candidate);
    if (!inside(root, resolved)) {
      throw new Error("resolved directory escapes the workspace or crosses a link");
    }
    if (!(await stat(resolved)).isDirectory()) {
      throw new Error("search path must be a directory");
    }
    return resolved;
  }

  return { root, resolveRead, resolveDirectory };
}
```

- [ ] **Step 2: Run the tests to verify GREEN**

Run:

```powershell
npm test --prefix codex-mcp -- --test-name-pattern="policy|workspace|credential|symlink"
```

Expected:

- Four path-policy tests pass

- [ ] **Step 3: Commit**

```powershell
git add .gitignore codex-mcp/package.json codex-mcp/tsconfig.json codex-mcp/server/src/paths.ts codex-mcp/server/tests/paths.test.ts
git commit -m "test: add codex workspace path policy"
```

## Task 3: Add and Implement the Bounded Result Store

**Files:**
- Create: `codex-mcp/server/tests/result-store.test.ts`
- Create: `codex-mcp/server/src/result-store.ts`

- [ ] **Step 1: Write the failing tests**

`codex-mcp/server/tests/result-store.test.ts`:

```typescript
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

test("expires references", async () => {
  const store = new ResultStore("session-a", 1);
  const ref = store.put({ value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.throws(() => store.page(ref, 0, 1, 4096), /expired/i);
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test --prefix codex-mcp -- --test-name-pattern="result"
```

Expected:

- FAIL because `ResultStore` is missing

- [ ] **Step 3: Implement the minimal store**

`codex-mcp/server/src/result-store.ts`:

```typescript
import { randomUUID } from "node:crypto";

type RecordValue = { createdAt: number; items: unknown[] };

export class ResultStore {
  private readonly records = new Map<string, RecordValue>();

  constructor(private readonly sessionId: string, private readonly ttlMs = 30 * 60_000) {}

  put(value: unknown): string {
    const items = Array.isArray(value)
      ? value
      : Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : [value];
    const ref = `opsref://${this.sessionId}/${randomUUID()}`;
    this.records.set(ref, { createdAt: Date.now(), items });
    return ref;
  }

  page(ref: string, offset = 0, limit = 32, maxBytes = 32768) {
    const record = this.records.get(ref);
    if (!record) throw new Error("result reference not found");
    if (Date.now() - record.createdAt > this.ttlMs) {
      this.records.delete(ref);
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
      if (items.length > 0 && bytes + encoded > safeBytes) break;
      items.push(item);
      bytes += encoded;
    }
    return {
      items,
      nextOffset: index < record.items.length ? index : null,
      total: record.items.length
    };
  }
}
```

- [ ] **Step 4: Run GREEN**

```powershell
npm test --prefix codex-mcp -- --test-name-pattern="result"
```

Expected:

- All result-store tests pass

- [ ] **Step 5: Commit**

```powershell
git add codex-mcp/server/src/result-store.ts codex-mcp/server/tests/result-store.test.ts
git commit -m "feat: add bounded codex result store"
```

## Task 4: Add the Worker Client Contract

**Files:**
- Create: `codex-mcp/server/src/worker-envelope.ts`
- Create: `codex-mcp/server/src/worker-client.ts`
- Create: `codex-mcp/server/tests/worker-client.test.ts`

- [ ] **Step 1: Write the failing worker-client test**

`codex-mcp/server/tests/worker-client.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkerClient } from "../src/worker-client.js";

test("invokes the native worker and parses JSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ops-worker-"));
  await writeFile(path.join(root, "hello.txt"), "hello\n");
  const client = new WorkerClient({
    workerPath: process.env.DSH_OPS_WORKER_PATH!,
    workspace: root,
    scope: "test-session"
  });
  await writeFile(path.join(root, "other.txt"), "other\n");
  const result = await client.readFiles([
    { path: "hello.txt", offset: 1, limit: 10 },
    { path: "other.txt", offset: 1, limit: 10 }
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.items.length, 2);
  const found = await client.search({
    mode: "files",
    pattern: "*.txt",
    path: ".",
    maxResults: 10
  });
  assert.equal(found.status, "completed");
});
```

- [ ] **Step 2: Run RED**

```powershell
$env:DSH_OPS_WORKER_PATH = (Resolve-Path native\target\release\*worker*.exe).Path
npm test --prefix codex-mcp -- --test-name-pattern="native worker"
```

Expected:

- FAIL because `WorkerClient` does not exist

- [ ] **Step 3: Implement envelope creation and worker invocation**

`codex-mcp/server/src/worker-envelope.ts`:

```typescript
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
```

`codex-mcp/server/src/worker-client.ts`:

```typescript
import { spawn } from "node:child_process";
import path from "node:path";
import { createPathPolicy } from "./paths.js";
import { workerEnvelope, WORKER_TIMEOUT_MS } from "./worker-envelope.js";

type WorkerClientOptions = {
  workerPath: string;
  workspace: string;
  scope: string;
};

export class WorkerClient {
  private readonly policyPromise;

  constructor(private readonly options: WorkerClientOptions) {
    this.policyPromise = createPathPolicy(options.workspace);
  }

  async readFiles(
    files: Array<{ path: string; offset: number; limit: number }>
  ): Promise<Record<string, unknown>> {
    const policy = await this.policyPromise;
    const resolvedFiles = await Promise.all(files.map(async (file) => ({
      ...file,
      path: await policy.resolveRead(file.path)
    })));
    return await this.invoke("read_files", { files: resolvedFiles });
  }

  async search(input: {
    mode: "files" | "content";
    pattern: string;
    path: string;
    maxResults: number;
  }): Promise<Record<string, unknown>> {
    const policy = await this.policyPromise;
    const root = await policy.resolveDirectory(input.path);
    if (input.mode === "files") {
      return await this.invoke("glob", {
        path: root,
        pattern: [input.pattern],
        outputMode: "paths",
        offset: 0,
        limit: input.maxResults
      });
    }
    return await this.invoke("grep", {
      path: root,
      pattern: input.pattern,
      glob: [],
      outputMode: "content",
      lineNumbers: true,
      offset: 0,
      limit: input.maxResults
    });
  }

  private async invoke(
    tool: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const policy = await this.policyPromise;
    const request = {
      root: policy.root,
      scope: this.options.scope,
      tool,
      args,
      read_only: true,
      deny_credential_names: true
    };
    const input = JSON.stringify(workerEnvelope(request));

    return await new Promise((resolve, reject) => {
      const child = spawn(this.options.workerPath, [], {
        cwd: policy.root,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => child.kill(), WORKER_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`worker exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
        } catch {
          reject(new Error("worker returned invalid JSON"));
        }
      });
      child.stdin.end(input);
    });
  }
}
```

- [ ] **Step 4: Run GREEN**

```powershell
$env:DSH_OPS_WORKER_PATH = (Resolve-Path native\target\release\*worker*.exe).Path
npm test --prefix codex-mcp -- --test-name-pattern="native worker"
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```powershell
git add codex-mcp/server/src/worker-envelope.ts codex-mcp/server/src/worker-client.ts codex-mcp/server/tests/worker-client.test.ts
git commit -m "feat: add native worker client"
```

## Task 5: Add MCP Schemas and Tool Handlers

**Files:**
- Create: `codex-mcp/server/src/schemas.ts`
- Create: `codex-mcp/server/tests/schemas.test.ts`

- [ ] **Step 1: Write schema validation tests**

`codex-mcp/server/tests/schemas.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { readFilesInput, searchInput } from "../src/schemas.js";

test("accepts a bounded multi-file read", () => {
  const input = readFilesInput.parse({
    files: [{ path: "a.ts" }, { path: "b.ts", offset: 2, limit: 10 }]
  });
  assert.equal(input.files.length, 2);
  assert.equal(input.files[0].offset, 1);
});

test("rejects search without a supported mode", () => {
  assert.throws(() => searchInput.parse({ mode: "regex-all", pattern: "x" }));
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test --prefix codex-mcp -- --test-name-pattern="schema|bounded|search"
```

Expected:

- FAIL because `schemas.ts` is missing

- [ ] **Step 3: Implement the schemas**

`codex-mcp/server/src/schemas.ts`:

```typescript
import { z } from "zod";

const fileRange = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(10000).default(200)
});

export const readFilesInput = z.object({
  files: z.array(fileRange).min(1).max(32),
  maxBytes: z.number().int().min(1024).max(65536).default(32768)
});

export const searchInput = z.object({
  mode: z.enum(["files", "content"]),
  pattern: z.string().min(1),
  path: z.string().default("."),
  maxResults: z.number().int().min(1).max(200).default(50),
  maxBytes: z.number().int().min(1024).max(65536).default(32768)
});

export const resultInput = z.object({
  ref: z.string().regex(/^opsref:\/\//),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(32),
  maxBytes: z.number().int().min(1024).max(65536).default(32768)
});
```

- [ ] **Step 4: Run GREEN**

```powershell
npm test --prefix codex-mcp -- --test-name-pattern="schema|bounded|search"
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```powershell
git add codex-mcp/server/src/schemas.ts codex-mcp/server/tests/schemas.test.ts
git commit -m "feat: define codex mcp tool schemas"
```

## Task 6: Add the Standalone MCP Server

**Files:**
- Create: `codex-mcp/server/src/index.ts`
- Create: `codex-mcp/bin/launcher.mjs`
- Modify: `codex-mcp/package.json`

- [ ] **Step 1: Add the server entrypoint**

`codex-mcp/server/src/index.ts`:

```typescript
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
    return { content: [{ type: "text" as const, text: encoded }] };
  }
  const ref = store.put(value);
  const continuation = Object.fromEntries(
    [
      "status",
      "complete",
      "nextIndex",
      "pending",
      "nextOffset",
      "continuation",
      "truncatedBy",
      "nextAction",
      "error"
    ]
      .filter((key) => key in value)
      .map((key) => [key, value[key]])
  );
  return text({
    ...continuation,
    truncated: true,
    nextRef: ref,
    total: Array.isArray(value.items) ? value.items.length : null,
    message: "Result exceeded maxBytes. Use ops_result with nextRef for returned items. If nextIndex or continuation is present, continue the original operation with those values."
  });
}

server.tool(
  "ops_read_files",
  "Read 1-32 bounded UTF-8 file ranges in one call.",
  readFilesInput.shape,
  async (input) => {
    const value = readFilesInput.parse(input);
    return bounded(await worker.readFiles(value.files), value.maxBytes);
  }
);

server.tool(
  "ops_search",
  "Search files or content under the workspace with bounded output.",
  searchInput.shape,
  async (input) => {
    const value = searchInput.parse(input);
    return bounded(await worker.search(value), value.maxBytes);
  }
);

server.tool(
  "ops_result",
  "Page a bounded opsref:// result returned by ops_read_files or ops_search.",
  resultInput.shape,
  async (input) => {
    const value = resultInput.parse(input);
    return text(store.page(value.ref, value.offset, value.limit, value.maxBytes));
  }
);

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Add a launcher that resolves paths**

`codex-mcp/bin/launcher.mjs`:

```javascript
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const configPath = process.env.DSH_OPS_CONFIG ??
  path.join(homedir(), ".dsh-ops-codex", "config.json");
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};
const workspace = process.env.DSH_OPS_WORKSPACE ?? config.workspace;
const worker = process.env.DSH_OPS_WORKER_PATH ?? config.workerPath;
if (!workspace || !worker) {
  throw new Error(`Missing workspace or worker path in ${configPath}`);
}
const child = spawn(process.execPath, [path.join(root, "server", "dist", "index.mjs")], {
  env: {
    ...process.env,
    DSH_OPS_WORKSPACE: workspace,
    DSH_OPS_WORKER_PATH: worker
  },
  stdio: "inherit"
});
child.on("exit", (code) => process.exit(code ?? 1));
```

- [ ] **Step 3: Build**

```powershell
npm install --prefix codex-mcp
npm run build --prefix codex-mcp
```

Expected:

- `codex-mcp/server/dist/index.mjs` exists
- TypeScript exits with code `0`

- [ ] **Step 4: Run a direct JSON-RPC smoke test**

```powershell
$env:DSH_OPS_WORKSPACE = (Get-Location).Path
$env:DSH_OPS_WORKER_PATH = (Resolve-Path native\target\release\*worker*.exe).Path
node codex-mcp\server\dist\index.mjs
```

Expected:

- The process waits for MCP JSON-RPC on stdin
- No crash before the first request

- [ ] **Step 5: Commit**

```powershell
git add codex-mcp/server/src/index.ts codex-mcp/bin/launcher.mjs codex-mcp/package.json codex-mcp/package-lock.json
git commit -m "feat: add codex stdio mcp server"
```

## Task 7: Add the Codex Skill

**Files:**
- Create: `codex-mcp/skills/dsh-ops-codex/SKILL.md`

- [ ] **Step 1: Write the Skill**

`codex-mcp/skills/dsh-ops-codex/SKILL.md`:

```markdown
---
name: dsh-ops-codex
description: Use when a Codex task requires read-only repository inspection across multiple files or bounded search results, especially when native single-file reads would waste tool calls or context.
---

# DSH Ops Codex

Use the `ops_read_files` MCP tool to read several files or many line ranges in one call.

Use `ops_search` for repository file discovery or content search when a bounded result is appropriate.

If either tool returns `nextRef`, use `ops_result` until `nextOffset` is `null` or the needed item is found. Do not request unrelated pages.

Prefer one batched `ops_read_files` call over several single-file reads. Do not repeat an unchanged read in the same task. Do not use these tools on credential files or outside the configured workspace.

These tools are read-only. They do not replace Codex built-in tools and do not provide editing, shell, or mutation capabilities.
```

- [ ] **Step 2: Validate the Skill**

Run:

```powershell
& 'C:\Users\朱俊杰\.ai-text-detector\venv\Scripts\python.exe' `
  'C:\Users\朱俊杰\.codex\skills\.system\skill-creator\scripts\quick_validate.py' `
  'codex-mcp\skills\dsh-ops-codex'
```

Expected:

- The validator prints `Skill is valid!`

- [ ] **Step 3: Commit**

```powershell
git add codex-mcp/skills/dsh-ops-codex/SKILL.md
git commit -m "feat: add codex ops skill"
```

## Task 8: Wire the MCP Server into Codex Desktop

**Files:**
- Create locally, not committed: `C:\Users\朱俊杰\.codex\config.toml` test profile
- Read: `codex-mcp/server/dist/index.mjs`

- [ ] **Step 1: Register the MCP server in a disposable profile**

Create a temporary profile file outside the repository:

```toml
[mcp_servers.dsh_ops_codex]
command = "node"
args = ["D:\\Users\\Documents\\GitHub\\ds-ops\\codex-mcp\\server\\dist\\index.mjs"]
env = { DSH_OPS_WORKSPACE = "D:\\Users\\Documents\\GitHub\\ds-ops", DSH_OPS_WORKER_PATH = "D:\\Users\\Documents\\GitHub\\ds-ops\\native\\target\\release\\dsh-ops-worker.exe" }
```

Expected:

- Codex starts the server
- Exactly three tools appear: `ops_read_files`, `ops_search`, `ops_result`

- [ ] **Step 2: Run an English read test with DeepSeek**

Prompt:

```text
Use ops_read_files to read the first 20 lines of Package.swift and README.md in one call, then summarize them.
```

Expected:

- The model calls `ops_read_files` once
- The tool result contains both files
- The model does not call built-in `read` twice

- [ ] **Step 3: Run a Chinese search test with DeepSeek**

Prompt:

```text
使用 ops_search 搜索 createRunCodeTool，返回前 10 个结果，不要调用 shell。
```

Expected:

- The model calls `ops_search`
- Output is compact
- No shell command is invoked

- [ ] **Step 4: Run the paging test**

Prompt:

```text
Use ops_read_files on README.md with limit 5000. If nextRef is returned, page only the first page with ops_result.
```

Expected:

- The first call returns `nextRef`
- The second call references `ops_result`
- The result stays under the configured byte cap

## Task 9: Add the Token and Behavior Gate

**Files:**
- Create: `codex-mcp/server/tests/schema-budget.test.ts`
- Create: `codex-mcp/docs/smoke-test.md` only if a durable test record is needed

- [ ] **Step 1: Measure the fixed tool schema**

Write a test that serializes the three tool schemas and counts `cl100k_base` tokens with `js-tiktoken`.

Threshold:

- Three tool definitions: at most 700 `cl100k_base` tokens
- Total MCP payload after one normal read/search: at most 64 KiB

- [ ] **Step 2: Measure task-level behavior**

Run this matrix:

| Task | Without adapter | With adapter | Pass condition |
|---|---:|---:|---|
| Read 8 small files | 8 calls | 1 call | Adapter uses one `ops_read_files` |
| Search 50 matches | Built-in grep output | Bounded JSON | Output <= 32 KiB or returns `nextRef` |
| Read long file | Truncated or repeated calls | Initial page + `ops_result` | No data loss |
| Read `.env` | Denied or not selected | Denied | No secret content returned |
| Path outside workspace | Denied | Denied | No file content returned |

- [ ] **Step 3: Apply a go/no-go rule**

Continue to plugin packaging only when all are true:

- DeepSeek performs the intended tool call in at least 4 of 5 trials per task.
- One batched file read replaces at least six single-file reads.
- Search and read outputs stay within the configured cap.
- The three tool schemas stay under the token threshold.
- Secret and escape-path tests never return content.

If any condition fails, stop plugin packaging and retain the standalone MCP setup for debugging.

## Task 10: Package the Codex Plugin

**Files:**
- Create: `codex-mcp/.agents/plugins/marketplace.json`
- Create: `codex-mcp/.mcp.json`
- Create: `codex-mcp/.codex-plugin/plugin.json`
- Create: `codex-mcp/bin/install-local.ps1`

- [ ] **Step 1: Add the local marketplace**

`codex-mcp/.agents/plugins/marketplace.json`:

```json
{
  "name": "dsh-ops-codex-local",
  "interface": {
    "displayName": "DSH Ops Codex Local"
  },
  "plugins": [
    {
      "name": "dsh-ops-codex",
      "source": {
        "source": "local",
        "path": "."
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

- [ ] **Step 2: Add the MCP declaration**

`codex-mcp/.mcp.json`:

```json
{
  "mcpServers": {
    "dsh_ops_codex": {
      "type": "stdio",
      "command": "node",
      "args": ["./bin/launcher.mjs"]
    }
  }
}
```

Before committing this file, verify that Codex resolves `./bin/launcher.mjs` relative to the plugin root. If it does not, `install-local.ps1` must write an absolute-path entry in the user's Codex config and the plugin must omit `mcpServers`. Do not rely on environment-variable placeholders.

- [ ] **Step 3: Add the plugin manifest**

`codex-mcp/.codex-plugin/plugin.json`:

```json
{
  "name": "dsh-ops-codex",
  "version": "0.1.0",
  "description": "Bounded read-only repository tools adapted from dsh-ops.",
  "license": "MIT",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "DSH Ops Codex",
    "shortDescription": "Batched file reads and bounded search",
    "longDescription": "Read multiple file ranges in one call, search repository content with bounded output, and page large results without modifying the workspace.",
    "developerName": "T-Auto fork contributors",
    "category": "Developer Tools",
    "capabilities": ["Read"],
    "defaultPrompt": [
      "Use dsh-ops-codex to inspect multiple files with one bounded read."
    ],
    "brandColor": "#245BDB",
    "screenshots": []
  }
}
```

- [ ] **Step 4: Add the local installer**

`codex-mcp/bin/install-local.ps1`:

```powershell
param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [string]$WorkerPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
if (-not $WorkerPath) {
    $WorkerPath = Join-Path (Split-Path -Parent $Root) "native\target\release\dsh-ops-worker.exe"
}
$WorkerPath = (Resolve-Path -LiteralPath $WorkerPath).Path
$ConfigRoot = Join-Path $HOME ".dsh-ops-codex"
$ConfigFile = Join-Path $ConfigRoot "config.json"
New-Item -ItemType Directory -Force -Path $ConfigRoot | Out-Null
[ordered]@{
    workspace = $Workspace
    workerPath = $WorkerPath
} | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding utf8
Write-Output "Wrote $ConfigFile"
```

This installer writes only to the user configuration directory and never writes secrets into the repository.

- [ ] **Step 5: Validate the plugin**

Run:

```powershell
codex plugin marketplace add D:\Users\Documents\GitHub\ds-ops\codex-mcp
codex plugin add dsh-ops-codex@dsh-ops-codex-local
```

Expected:

- Plugin appears in the local marketplace
- Its Skill and MCP server are discovered
- Only the three approved tools are exposed

- [ ] **Step 6: Commit**

```powershell
git add codex-mcp/.agents/plugins/marketplace.json codex-mcp/.mcp.json codex-mcp/.codex-plugin/plugin.json codex-mcp/bin/install-local.ps1
git commit -m "feat: package codex read-only mcp plugin"
```

## Task 11: Final Verification and Documentation

**Files:**
- Create: `codex-mcp/README.md`
- Modify: `README.md` with one link under development/adapters

- [ ] **Step 1: Run all automated checks**

```powershell
cargo test --manifest-path native/Cargo.toml
$env:DSH_OPS_WORKER_PATH = (Resolve-Path native\target\release\dsh-ops-worker.exe).Path
npm test --prefix codex-mcp
npm run build --prefix codex-mcp
```

Expected:

- All commands exit with code `0`

- [ ] **Step 2: Run the Codex integration matrix**

Repeat Task 9 with the packaged plugin instead of direct config.

Expected:

- Same behavior and token bounds
- No change when the plugin is disabled

- [ ] **Step 3: Document installation and limitations**

`codex-mcp/README.md` must state:

- Windows x64 only in the first release
- Read-only only
- Three-tool surface
- Required `DSH_OPS_WORKSPACE` and `DSH_OPS_WORKER_PATH`
- No replacement of Codex built-ins
- No DSH duplicate-read suppression
- No Bash or mutation tools
- Known DeepSeek tool-calling limitations from the integration matrix

- [ ] **Step 4: Commit**

```powershell
git add codex-mcp/README.md README.md
git commit -m "docs: document codex read-only adapter"
```

## Acceptance Criteria

The first release is complete only when:

- `ops_read_files`, `ops_search`, and `ops_result` work through Codex Desktop with the DeepSeek provider.
- The plugin never exposes more than these three tools.
- The server fails closed without a verified workspace root.
- Credential paths, outside-root paths, symlinks, and junctions cannot return file content.
- No mutation or shell tool is published.
- Long results are paged without silent data loss.
- Tool schema overhead stays below the agreed measured budget.
- The standalone MCP setup and packaged plugin pass the same behavioral tests.
