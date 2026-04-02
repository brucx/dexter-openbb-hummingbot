/**
 * BridgeClient — spawns a Python bridge subprocess and communicates via JSON Lines.
 *
 * This is the TypeScript side of the stdin/stdout JSON Lines protocol.
 * It manages the child process lifecycle and correlates request/response IDs.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { OpenBBMethod, OpenBBRequest, OpenBBResponse } from "../types/bridge-protocol";

export interface BridgeClientOptions {
  /** Path to the Python script */
  scriptPath: string;
  /** Python executable (default: "python3") */
  pythonBin?: string;
  /** Environment variables to pass to the child process */
  env?: Record<string, string>;
  /** Timeout in ms for a single request (default: 30000) */
  timeoutMs?: number;
}

export class BridgeClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private pending = new Map<string, {
    resolve: (resp: OpenBBResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private options: Required<BridgeClientOptions>;
  private _ready = false;
  private stderrLines: string[] = [];

  constructor(options: BridgeClientOptions) {
    this.options = {
      scriptPath: options.scriptPath,
      pythonBin: options.pythonBin ?? "python3",
      env: options.env ?? {},
      timeoutMs: options.timeoutMs ?? 30_000,
    };
  }

  /** Start the bridge subprocess. */
  start(): void {
    if (this.process) return;

    this.process = spawn(this.options.pythonBin, [this.options.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.options.env },
    });

    this.readline = createInterface({ input: this.process.stdout! });
    this.readline.on("line", (line: string) => this._handleLine(line));

    // Capture stderr for diagnostics
    const stderrRL = createInterface({ input: this.process.stderr! });
    stderrRL.on("line", (line: string) => {
      this.stderrLines.push(line);
      // Keep last 50 lines
      if (this.stderrLines.length > 50) this.stderrLines.shift();
    });

    this.process.on("exit", (code) => {
      this._ready = false;
      // Reject all pending requests
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Bridge process exited with code ${code}`));
        this.pending.delete(id);
      }
    });

    this._ready = true;
  }

  /** Send a request and wait for the correlated response. */
  async request(method: OpenBBMethod, params: Record<string, unknown> = {}): Promise<OpenBBResponse> {
    if (!this.process?.stdin || !this._ready) {
      throw new Error("Bridge not started. Call .start() first.");
    }

    const id = randomUUID();
    const req: OpenBBRequest = { id, method, params };

    return new Promise<OpenBBResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request timed out after ${this.options.timeoutMs}ms (method: ${method})`));
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const line = JSON.stringify(req) + "\n";
      this.process!.stdin!.write(line);
    });
  }

  /** Stop the bridge subprocess. */
  stop(): void {
    if (!this.process) return;
    this._ready = false;
    this.readline?.close();
    this.process.stdin?.end();
    this.process.kill();
    this.process = null;
  }

  /** Whether the bridge is running. */
  get ready(): boolean {
    return this._ready;
  }

  /** Recent stderr output from the bridge (for diagnostics). */
  get diagnostics(): string[] {
    return [...this.stderrLines];
  }

  private _handleLine(line: string): void {
    let resp: OpenBBResponse;
    try {
      resp = JSON.parse(line) as OpenBBResponse;
    } catch {
      return; // ignore non-JSON lines
    }

    const entry = this.pending.get(resp.id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(resp.id);
      entry.resolve(resp);
    }
  }
}
