---
name: dsh-ops-codex
description: Use for read-only repository inspection that benefits from one batched call or bounded search, including Chinese requests to 批量读取、同时查看多个文件、搜索仓库内容、只读取相关片段或节省上下文. Do not use it for a single small file read or a simple search that Codex built-ins already handle efficiently.
---

# DSH Ops Codex

Use this skill only when its read-only MCP tools are available. It does not
replace Codex built-in tools and provides no editing, shell, or mutation
capability.

## Route the work

- Use `ops_read_files` for two or more files, several line ranges, or one
  efficient batch that replaces several small reads.
- Use `ops_search` for repository-wide file discovery or content search when
  bounded results are useful. Set `mode` to `files` for a glob or `content`
  for a regular expression.
- Prefer a built-in single-file read or direct search when only one small,
  obvious lookup is needed.

Read one to 32 file ranges per `ops_read_files` call. Paths are relative to
the configured workspace, so do not invent or pass a workspace root. Never
request credential files, links, or paths that leave the workspace.

## Work efficiently

1. Search first when the relevant paths are not known.
2. Batch related reads and request only the lines needed for the task.
3. Reuse evidence already read in the task. Do not repeat an unchanged read.
4. Stop paging as soon as the needed evidence is available.
5. If the MCP tools are unavailable or fail closed, continue with Codex
   built-ins rather than inventing a workaround.

## Continue bounded results

When a tool returns `nextRef`, call `ops_result` for useful pages rather than
requesting unrelated content.

- Search continuation: pass the returned `nextOffset` and `continuation`
  back to `ops_search` with the same search fields.
- Batched file continuation: use `nextIndex` to rebuild the remaining file
  list, then make another bounded `ops_read_files` call.
- Item pages: continue with `nextOffset` until it is `null` or enough items
  have been inspected.
- Character chunks: while `nextCharOffset` is a number, keep the same
  `nextOffset` and pass the returned value as `charOffset`. Do not skip the
  undisplayed suffix.
- Do not use a reference from another task or MCP server session.
