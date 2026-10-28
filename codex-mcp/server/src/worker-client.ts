import { spawn } from "node:child_process";
import { createPathPolicy } from "./paths.js";
import {
  workerEnvelope,
  WORKER_OUTPUT_BYTES,
  WORKER_TIMEOUT_MS
} from "./worker-envelope.js";

type WorkerClientOptions = {
  workerPath: string;
  workspace: string;
  scope: string;
};

export type WorkerResult = {
  status?: string;
  items?: unknown[];
  [key: string]: unknown;
};

export class WorkerClient {
  private readonly policyPromise;

  constructor(private readonly options: WorkerClientOptions) {
    this.policyPromise = createPathPolicy(options.workspace);
  }

  async readFiles(
    files: Array<{ path: string; offset: number; limit: number }>
  ): Promise<WorkerResult> {
    const policy = await this.policyPromise;
    const resolvedFiles = await Promise.all(
      files.map(async (file) => ({
        ...file,
        path: await policy.resolveRead(file.path)
      }))
    );
    return await this.invoke("read_files", { files: resolvedFiles });
  }

  async search(input: {
    mode: "files" | "content";
    pattern: string;
    path: string;
    maxResults: number;
  }): Promise<WorkerResult> {
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
  ): Promise<WorkerResult> {
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
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error("native worker timed out")));
      }, WORKER_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > WORKER_OUTPUT_BYTES) {
          child.kill();
          finish(() => reject(new Error("native worker exceeded output budget")));
          return;
        }
        stdout.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 16 * 1024) {
          child.kill();
          finish(() => reject(new Error("native worker exceeded stderr budget")));
          return;
        }
        stderr.push(Buffer.from(chunk));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(() => {
          if (code !== 0) {
            reject(
              new Error(
                `worker exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`
              )
            );
            return;
          }
          try {
            const value = JSON.parse(Buffer.concat(stdout).toString("utf8"));
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              reject(new Error("worker returned a non-object result"));
              return;
            }
            resolve(value as WorkerResult);
          } catch {
            reject(new Error("worker returned invalid JSON"));
          }
        });
      });
      child.stdin.on("error", (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
      child.stdin.end(input);
    });
  }
}
