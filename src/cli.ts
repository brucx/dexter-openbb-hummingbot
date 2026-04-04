#!/usr/bin/env npx tsx
/**
 * CLI for trade analysis and proposal management.
 *
 * Usage:
 *   npx tsx src/cli.ts analyze <SYMBOL>            Research a symbol and generate a proposal
 *   npx tsx src/cli.ts proposals list               List all saved proposals
 *   npx tsx src/cli.ts proposals show <id>          Show a single proposal in detail
 *   npx tsx src/cli.ts proposals approve <id>       Approve a proposal
 *   npx tsx src/cli.ts proposals reject <id> [--reason "..."]  Reject a proposal
 */

import { createProposalStore } from "./services/persistence";
import { formatProposal, formatProposalList, buildResearchSummary } from "./services/format";
import type { ListPriceContext, AnalysisModeInfo } from "./services/format";
import { analyzeSymbol } from "./services/workflow";

const store = createProposalStore();

const args = process.argv.slice(2);
const domain = args[0];
const command = args[1];

function usage(): void {
  console.log(`
dexter — trade analysis and proposal management

Usage:
  dexter analyze <SYMBOL>                   Research a symbol and generate a trade proposal
  dexter proposals list                     List all saved proposals
  dexter proposals list --status <status>   Filter by status (proposed, approved, rejected)
  dexter proposals show <id>                Show a single proposal in detail
  dexter proposals approve <id>             Approve a proposal
  dexter proposals reject <id> [--reason "reason"]  Reject a proposal

Workflow:
  1. dexter analyze AAPL          Gather research, assess data, generate proposal
  2. dexter proposals show <id>   Review the proposal with full research context
  3. dexter proposals approve <id>   or   dexter proposals reject <id>
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

if (domain === "analyze" || domain === "a") {
  const symbol = args[1];
  if (!symbol || symbol.startsWith("-")) {
    console.error("Usage: dexter analyze <SYMBOL>");
    console.error("  Example: dexter analyze AAPL");
    process.exit(1);
  }

  const bridgeMode = process.env.OPENBB_BRIDGE_MODE;
  const env: Record<string, string> = {};
  if (bridgeMode) {
    env.OPENBB_BRIDGE_MODE = bridgeMode;
  }

  console.log(`\nAnalyzing ${symbol.toUpperCase()}...`);

  try {
    const result = await analyzeSymbol({
      symbol: symbol.toUpperCase(),
      pythonBin: process.env.OPENBB_PYTHON_BIN,
      env,
      store,
    });

    // Show data quality summary
    const dq = result.proposal.dataQuality;
    const srcLine = [
      `Quote: ${dq.sources.quote}`,
      `History: ${dq.sources.priceHistory}`,
      `Financials: ${dq.sources.financials}`,
      `News: ${dq.sources.news}`,
    ].join("  ");
    console.log(`\nData sources: ${srcLine}`);

    if (dq.confidenceWasCapped) {
      console.log(`Note: Confidence capped to "${dq.maxConfidence}" based on data availability.`);
    }

    if (result.intent) {
      // Show the formatted proposal
      const snapshot = result.research;
      const researchSummary = buildResearchSummary(snapshot);
      const analysisMode: AnalysisModeInfo = {
        usedLLM: result.usedLLMAnalysis,
        model: result.proposal.llmModel,
        fallbackReason: result.usedLLMAnalysis ? undefined : result.llmStatus,
        tokenUsage: result.llmTokenUsage,
      };
      console.log();
      console.log(formatProposal(result.intent, {
        showId: true,
        usedFallbackData: result.proposal.usedFallbackData,
        researchSummary,
        analysisMode,
      }));

      // Next steps guidance
      console.log();
      console.log(`Proposal saved: ${result.shortId}...`);
      console.log();
      console.log(`Next steps:`);
      console.log(`  dexter proposals show ${result.shortId}     Review in detail`);
      console.log(`  dexter proposals approve ${result.shortId}  Approve for execution`);
      console.log(`  dexter proposals reject ${result.shortId}   Reject with reason`);
      console.log();
    } else {
      console.error(`\nProposal generation failed:`);
      if (result.proposal.errors.length > 0) {
        for (const e of result.proposal.errors) {
          console.error(`  - ${e}`);
        }
      } else {
        console.error(`  No explicit errors were reported. This may indicate insufficient`);
        console.error(`  data to form a trade thesis. Try a different symbol or check`);
        console.error(`  that the OpenBB bridge is returning data (OPENBB_BRIDGE_MODE=${process.env.OPENBB_BRIDGE_MODE ?? "auto"}).`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`\nAnalysis failed: ${(err as Error).message}`);
    process.exit(1);
  }
} else if (domain === "proposals" || domain === "p") {
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
