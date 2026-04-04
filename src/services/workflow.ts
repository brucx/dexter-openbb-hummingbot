/**
 * Workflow — thin orchestration layer for the research → proposal pipeline.
 *
 * This is the "analyze" workflow: given a symbol, gather research, assess
 * data quality, generate a proposal, persist both, and return a structured
 * result that the CLI (or any future consumer) can display.
 *
 * Deliberately thin — it composes existing services rather than abstracting them.
 */

import { ResearchService } from "./research";
import type { ResearchSnapshot } from "./research";
import { autoDraftProposal, autoDraftProposalWithLLM } from "./proposal";
import type { ProposalResult } from "./proposal";
import { createProposalStore } from "./persistence";
import type { ProposalStore } from "./persistence";
import type { TradeIntent } from "../types/trade-intent";
import { detectLLMConfig } from "./llm-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Stock symbol to analyze (e.g. "AAPL") */
  symbol: string;

  /** Python binary for the OpenBB bridge (default: env OPENBB_PYTHON_BIN or "python3") */
  pythonBin?: string;

  /** Bridge environment overrides (e.g. OPENBB_BRIDGE_MODE) */
  env?: Record<string, string>;

  /** Existing ProposalStore to use (default: creates one) */
  store?: ProposalStore;

  /** Pre-configured ResearchService (default: creates one from pythonBin/env) */
  service?: ResearchService;

  /** Use LLM-assisted analysis if available (default: true) */
  useLLM?: boolean;
}

export interface AnalyzeResult {
  /** The symbol that was analyzed */
  symbol: string;

  /** Full research snapshot */
  research: ResearchSnapshot;

  /** Proposal generation result (includes data quality assessment) */
  proposal: ProposalResult;

  /** The saved TradeIntent, if proposal was valid */
  intent: TradeIntent | null;

  /** File path where the proposal was saved */
  proposalPath: string | null;

  /** File path where the research sidecar was saved */
  researchPath: string | null;

  /** Short ID for CLI reference */
  shortId: string | null;

  /** Whether LLM analysis was used for this proposal */
  usedLLMAnalysis: boolean;

  /** LLM availability info (for diagnostics) */
  llmStatus: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the bridge to either stabilize or crash.
 *
 * Polls `service.ready` in short intervals. If the process exits during
 * startup (e.g. bad Python path, missing deps), `ready` flips to false and
 * we surface diagnostics immediately — no fixed sleep that might be too
 * short *or* too long.
 */
async function waitForBridge(
  service: ResearchService,
  { intervalMs = 50, maxWaitMs = 2000 } = {},
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  // Short initial delay so the OS has time to exec + potentially fail
  await new Promise((r) => setTimeout(r, intervalMs));

  while (Date.now() < deadline) {
    if (!service.ready) {
      const diag = service.diagnostics;
      throw new Error(
        `Bridge process exited during startup.${diag.length > 0 ? "\n  " + diag.join("\n  ") : ""}`,
      );
    }
    // If process is still alive after initial delay, it's likely ready
    // (the bridge is a long-running stdin/stdout process — if it survived
    // the first ~100ms it parsed its imports successfully).
    if (Date.now() - (deadline - maxWaitMs) >= 100) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Run the full analyze workflow for a symbol:
 *
 * 1. Start research service (OpenBB bridge)
 * 2. Gather research snapshot (quote, history, financials, news — in parallel)
 * 3. Assess data quality and generate proposal (with graceful degradation)
 * 4. Persist proposal + research sidecar to disk
 * 5. Return structured result
 *
 * The caller is responsible for display. This function handles orchestration only.
 */
export async function analyzeSymbol(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { symbol, pythonBin, env } = options;
  const useLLM = options.useLLM ?? true;
  const store = options.store ?? createProposalStore();

  const service = options.service ?? new ResearchService({ pythonBin, env });

  // Check LLM availability upfront for diagnostics
  const llmAvailability = detectLLMConfig();
  const llmStatus = useLLM
    ? llmAvailability.reason
    : "LLM analysis disabled by caller";

  try {
    service.start();
    await waitForBridge(service);

    // Step 1: Research
    const research = await service.research(symbol);

    // Step 2: Generate proposal
    // Try LLM-assisted analysis if enabled and available; otherwise heuristic
    let proposal: ProposalResult;
    if (useLLM && llmAvailability.available) {
      proposal = await autoDraftProposalWithLLM(research);
    } else {
      proposal = autoDraftProposal(research);
      proposal.usedLLMAnalysis = false;
    }

    // Step 3: Persist
    let proposalPath: string | null = null;
    let researchPath: string | null = null;
    let shortId: string | null = null;

    if (proposal.intent) {
      proposalPath = store.save(proposal.intent);
      researchPath = store.saveResearch(proposal.intent.id, research);
      shortId = proposal.intent.id.slice(0, 8);
    }

    return {
      symbol,
      research,
      proposal,
      intent: proposal.intent,
      proposalPath,
      researchPath,
      shortId,
      usedLLMAnalysis: proposal.usedLLMAnalysis ?? false,
      llmStatus: proposal.usedLLMAnalysis
        ? llmStatus
        : (proposal.fallbackCategory === "no_llm_configured"
            ? (proposal.fallbackDetail || llmStatus)
            : proposal.fallbackCategory
              ? `LLM fallback — ${proposal.fallbackCategory}${proposal.fallbackDetail ? `: ${proposal.fallbackDetail}` : ""}`
              : llmStatus),
    };
  } finally {
    service.stop();
  }
}
