#!/usr/bin/env npx tsx
/**
 * CLI for managing trade proposals.
 *
 * Usage:
 *   npx tsx src/cli.ts proposals list
 *   npx tsx src/cli.ts proposals show <id>
 *   npx tsx src/cli.ts proposals approve <id>
 *   npx tsx src/cli.ts proposals reject <id> [--reason "..."]
 */

import { createProposalStore } from "./services/persistence";
import { formatProposal, formatProposalList, buildResearchSummary } from "./services/format";
import type { ListPriceContext } from "./services/format";

const store = createProposalStore();

const args = process.argv.slice(2);
const domain = args[0];
const command = args[1];

function usage(): void {
  console.log(`
dexter — trade proposal management

Usage:
  dexter proposals list                     List all saved proposals
  dexter proposals list --status <status>   Filter by status (proposed, approved, rejected)
  dexter proposals show <id>                Show a single proposal in detail
  dexter proposals approve <id>             Approve a proposal
  dexter proposals reject <id> [--reason "reason"]  Reject a proposal
`);
}

function findFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function resolveId(partial: string): string | null {
  // Support prefix matching so users don't need to type the full UUID
  const ids = store.list();
  const exact = ids.find((id) => id === partial);
  if (exact) return exact;

  const matches = ids.filter((id) => id.startsWith(partial));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    console.error(`Ambiguous ID prefix "${partial}" — matches ${matches.length} proposals:`);
    for (const m of matches.slice(0, 5)) console.error(`  ${m}`);
    return null;
  }

  console.error(`No proposal found matching "${partial}".`);
  return null;
}

if (domain === "proposals" || domain === "p") {
  switch (command) {
    case "list":
    case "ls": {
      const statusFilter = findFlag("--status");
      let proposals = store.loadAll();
      if (statusFilter) {
        proposals = proposals.filter((p) => p.status === statusFilter);
      }
      if (proposals.length === 0) {
        console.log(statusFilter ? `No proposals with status "${statusFilter}".` : "No saved proposals.");
      } else {
        // Build price context from research sidecars
        const priceCtx: ListPriceContext = new Map();
        for (const p of proposals) {
          const snap = store.loadResearch(p.id);
          if (snap?.quote) {
            priceCtx.set(p.id, { price: snap.quote.price, changePct: snap.quote.changePct });
          }
        }
        console.log(`\n${proposals.length} proposal(s)${statusFilter ? ` [${statusFilter}]` : ""}:\n`);
        console.log(formatProposalList(proposals, priceCtx.size > 0 ? priceCtx : undefined));
        console.log();
      }
      break;
    }

    case "show": {
      const rawId = args[2];
      if (!rawId) {
        console.error("Usage: dexter proposals show <id>");
        process.exit(1);
      }
      const id = resolveId(rawId);
      if (!id) process.exit(1);

      const intent = store.load(id);
      if (!intent) {
        console.error(`Proposal ${id} not found.`);
        process.exit(1);
      }

      // Load research sidecar for enriched display
      const snapshot = store.loadResearch(id);
      const researchSummary = snapshot ? buildResearchSummary(snapshot) : undefined;
      const usedFallbackData = snapshot
        ? Boolean(snapshot.quote?.isFallback || snapshot.priceHistory?.isFallback || snapshot.financials?.isFallback || snapshot.news?.isFallback)
        : undefined;

      console.log();
      console.log(formatProposal(intent, { showId: true, usedFallbackData, researchSummary }));
      if (!snapshot) {
        console.log(`  (No research snapshot saved for this proposal)`);
      }
      console.log();
      break;
    }

    case "approve": {
      const rawId = args[2];
      if (!rawId) {
        console.error("Usage: dexter proposals approve <id>");
        process.exit(1);
      }
      const id = resolveId(rawId);
      if (!id) process.exit(1);

      const current = store.load(id);
      if (!current) {
        console.error(`Proposal ${id} not found.`);
        process.exit(1);
      }
      if (current.status !== "proposed") {
        console.error(`Cannot approve — proposal is already "${current.status}".`);
        process.exit(1);
      }

      const updated = store.updateStatus(id, { status: "approved" });
      console.log(`\nApproved proposal ${id.slice(0, 8)}… for ${updated!.asset}`);
      console.log(`  Approved by: ${updated!.approved_by}`);
      console.log(`  Approved at: ${updated!.approved_at}\n`);
      break;
    }

    case "reject": {
      const rawId = args[2];
      if (!rawId) {
        console.error("Usage: dexter proposals reject <id> [--reason \"...\"]");
        process.exit(1);
      }
      const id = resolveId(rawId);
      if (!id) process.exit(1);

      const current = store.load(id);
      if (!current) {
        console.error(`Proposal ${id} not found.`);
        process.exit(1);
      }
      if (current.status !== "proposed") {
        console.error(`Cannot reject — proposal is already "${current.status}".`);
        process.exit(1);
      }

      const reason = findFlag("--reason");
      const updated = store.updateStatus(id, { status: "rejected", rejection_reason: reason });
      console.log(`\nRejected proposal ${id.slice(0, 8)}… for ${updated!.asset}`);
      if (updated!.rejection_reason) {
        console.log(`  Reason: ${updated!.rejection_reason}`);
      }
      console.log();
      break;
    }

    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} else {
  usage();
  process.exit(domain ? 1 : 0);
}
