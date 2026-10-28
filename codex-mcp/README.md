# DSH Ops Codex MCP Adapter

Windows x64, read-only repository inspection for Codex Desktop using the
existing `dsh-ops` Rust worker.

## Scope

The adapter exposes exactly three MCP tools:

| Tool | Purpose |
| --- | --- |
| `ops_read_files` | Read 1-32 line ranges in one bounded call |
| `ops_search` | Discover paths or search content with bounded output |
| `ops_result` | Page oversized results through a session reference |

It does not replace Codex built-in tools. It provides no editing, shell,
Bash, process, or mutation capability. It does not port DSH duplicate-read
suppression, which depends on DSH message and stream events.

## Requirements

- Windows x64
- Node.js 22.19 or newer
- Codex Desktop or Codex CLI
- `native/target/release/dsh-ops-worker.exe`

The resolved workspace and worker path are required. The launcher accepts
them from `DSH_OPS_WORKSPACE` and `DSH_OPS_WORKER_PATH`, or from
`%USERPROFILE%\.dsh-ops-codex\config.json`. Environment variables take
precedence.

The MCP server fails closed when neither source provides both values.

## Install

From the repository root:

```powershell
cargo build --release --manifest-path native/Cargo.toml
npm install --prefix codex-mcp
npm run build --prefix codex-mcp

$Repo = (Resolve-Path .).Path
codex plugin marketplace add "$Repo\codex-mcp"
codex plugin add dsh-ops-codex@dsh-ops-codex-local
& "$Repo\codex-mcp\bin\install-local.ps1" -Workspace $Repo
```

The installer writes the runtime config and registers `dsh_ops_codex` with
absolute `node.exe`, launcher, workspace, and worker paths. This absolute
registration is intentional: Codex 0.164.0 did not reliably resolve the
plugin's relative `.mcp.json` launcher.

Start a new Codex session after installation. Check the registration with:

```powershell
codex plugin list
codex mcp get dsh_ops_codex
```

Pass `-WorkerPath` if the worker is not at
`native\target\release\dsh-ops-worker.exe`.

To update, rebuild the server, reinstall the local plugin, and run the
installer again so the absolute launcher path is refreshed.

## Safety

- The model cannot provide the workspace root.
- Absolute paths, parent traversal, credential-shaped files, links, junctions,
  and reparse points are rejected.
- Search excludes hidden entries, `.git`, dependencies, credential paths, and
  linked objects.
- `maxBytes` is bounded between 1 KiB and 64 KiB.
- Oversized results are stored in a session-scoped, expiring in-memory store.
- References cannot cross sessions or MCP server restarts.

Result references page stored output only. They do not grant filesystem
authority. For a character chunk, keep the same `nextOffset` and advance
`charOffset`; do not skip an undisplayed suffix.

## Validation

Automated checks:

```powershell
$env:DSH_OPS_WORKER_PATH = (Resolve-Path 'native\target\release\dsh-ops-worker.exe').Path
npm test --prefix codex-mcp
npm run build --prefix codex-mcp
```

The suite covers the three-tool surface, path and credential denial, bounded
result paging, search continuations, stdio integration, schema size, and normal
payload size.

The three tool schemas use 642 `cl100k_base` tokens, below the 700-token gate.

DeepSeek `deepseek-v4-flash` passed 5/5 packaged behavior trials for:

- one eight-file batched read;
- a 50-result bounded search;
- long-file `nextRef` followed by `ops_result`;
- `.env` denial;
- workspace escape denial.

DeepSeek may repeat a large tool result in its final prose. The Skill therefore
asks for the needed evidence and discourages unrelated paging or output.

## Known Limits

- The first release supports Windows x64 only.
- Search can report incomplete coverage for invalidly encoded files; narrow the
  query rather than treating a partial scan as a complete total.
- Each Codex process still loads other configured MCP servers. The 642-token
  measurement covers only this adapter's three tool definitions.
- The current Desktop session does not hot-load newly installed MCP tools or
  Skills; use a new session after installation.

## License

MIT. See the repository [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
