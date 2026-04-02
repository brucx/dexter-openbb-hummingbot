/**
 * Proposal persistence — save and load TradeIntent proposals as JSON files.
 *
 * Proposals are stored in a configurable directory (default: data/proposals/)
 * as individual JSON files named by their ID.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TradeIntent } from "../types/trade-intent";

const DEFAULT_DIR = "data/proposals";

export interface ProposalStore {
  /** Save a proposal to disk. Returns the file path. */
  save(intent: TradeIntent): string;

  /** Load a proposal by ID. Returns null if not found. */
  load(id: string): TradeIntent | null;

  /** List all saved proposal IDs, most recent first. */
  list(): string[];

  /** Load all saved proposals, most recent first. */
  loadAll(): TradeIntent[];

  /** Update a proposal's status (approve/reject). Returns the updated intent, or null if not found. */
  updateStatus(id: string, update: StatusUpdate): TradeIntent | null;
}

export interface StatusUpdate {
  status: "approved" | "rejected";
  approved_by?: string;
  rejection_reason?: string;
}

export function createProposalStore(dir = DEFAULT_DIR): ProposalStore {
  mkdirSync(dir, { recursive: true });

  function filePath(id: string): string {
    // Sanitize ID to prevent directory traversal
    const safe = id.replace(/[^a-zA-Z0-9\-]/g, "");
    return join(dir, `${safe}.json`);
  }

  return {
    save(intent: TradeIntent): string {
      const path = filePath(intent.id);
      writeFileSync(path, JSON.stringify(intent, null, 2) + "\n", "utf-8");
      return path;
    },

    load(id: string): TradeIntent | null {
      const path = filePath(id);
      if (!existsSync(path)) return null;
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as TradeIntent;
    },

    list(): string[] {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
        .reverse();
    },

    loadAll(): TradeIntent[] {
      return this.list()
        .map((id) => this.load(id))
        .filter((i): i is TradeIntent => i !== null)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },

    updateStatus(id: string, update: StatusUpdate): TradeIntent | null {
      const intent = this.load(id);
      if (!intent) return null;

      intent.status = update.status;
      if (update.status === "approved") {
        intent.approved_by = update.approved_by ?? "human";
        intent.approved_at = new Date().toISOString();
      }
      if (update.status === "rejected" && update.rejection_reason) {
        intent.rejection_reason = update.rejection_reason;
      }

      this.save(intent);
      return intent;
    },
  };
}
