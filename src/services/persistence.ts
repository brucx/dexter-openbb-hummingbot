/**
 * Proposal persistence — save and load TradeIntent proposals as JSON files.
 *
 * Proposals are stored in a configurable directory (default: data/proposals/)
 * as individual JSON files named by their ID.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TradeIntent } from "../types/trade-intent";
import type { ResearchSnapshot } from "./research";

const DEFAULT_DIR = "data/proposals";

export interface ProposalStore {
  /** Save a proposal to disk. Returns the file path. */
  save(intent: TradeIntent): string;

  /** Save the research snapshot that backs a proposal (sidecar file). */
  saveResearch(id: string, snapshot: ResearchSnapshot): string;

  /** Load the research snapshot for a proposal. Returns null if not found. */
  loadResearch(id: string): ResearchSnapshot | null;

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

  function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9\-]/g, "");
  }

  function filePath(id: string): string {
    return join(dir, `${sanitizeId(id)}.json`);
  }

  function researchPath(id: string): string {
    return join(dir, `${sanitizeId(id)}.research.json`);
  }

  return {
    save(intent: TradeIntent): string {
      const path = filePath(intent.id);
      writeFileSync(path, JSON.stringify(intent, null, 2) + "\n", "utf-8");
      return path;
    },

    saveResearch(id: string, snapshot: ResearchSnapshot): string {
      const path = researchPath(id);
      writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
      return path;
    },

    loadResearch(id: string): ResearchSnapshot | null {
      const path = researchPath(id);
      if (!existsSync(path)) return null;
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as ResearchSnapshot;
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
        .filter((f) => f.endsWith(".json") && !f.endsWith(".research.json"))
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
