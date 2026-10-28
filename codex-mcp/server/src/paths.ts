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
  const parts = relative.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
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
