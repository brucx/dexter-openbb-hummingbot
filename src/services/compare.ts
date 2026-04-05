/**
 * Comparison engine — generates both heuristic and LLM proposals for the
 * same research snapshot and produces a structured side-by-side result.
 *
 * This lets an operator judge whether LLM analysis adds value over the
 * deterministic heuristic path for a given symbol/data context.
 */

import type { ResearchSnapshot } from "./research";
import { autoDraftProposal, autoDraftProposalWithLLM, extractSignals } from "./proposal";
import type { ProposalResult, ResearchSignals } from "./proposal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Side-by-side comparison of heuristic vs LLM proposal for the same data. */
export interface ComparisonResult {
  symbol: string;
  timestamp: string;

  /** Signals both paths were given (shared input). */
  signals: ResearchSignals;

  /** Heuristic-generated proposal (always succeeds). */
  heuristic: ProposalResult;

  /** LLM-generated proposal (may fall back to heuristic internally). */
  llm: ProposalResult;

  /** Whether the LLM path actually used LLM (vs falling back to heuristic). */
  llmActuallyUsed: boolean;

  /** Structured deltas between the two proposals. */
  deltas: ComparisonDeltas;
}

/** Measurable differences between heuristic and LLM proposals. */
export interface ComparisonDeltas {
  /** Whether confidence levels differ. */
  confidenceDiffers: boolean;
  heuristicConfidence: string;
  llmConfidence: string;

  /** Thesis length comparison (characters). */
  heuristicThesisLength: number;
  llmThesisLength: number;

  /** Factor/risk counts. */
  heuristicFactorCount: number;
  llmFactorCount: number;
  heuristicRiskCount: number;
  llmRiskCount: number;

  /** Factors unique to each path. */
  heuristicOnlyFactors: string[];
  llmOnlyFactors: string[];

  /** Risks unique to each path. */
  heuristicOnlyRisks: string[];
  llmOnlyRisks: string[];

  /** Direction agreement. */
  directionAgrees: boolean;

  /** Token cost of the LLM path (0 if LLM wasn't used). */
  llmTokens: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface CompareOptions {
  /** Timeout for LLM API call in ms (default: 30000). */
  timeoutMs?: number;

  /** Env vars for LLM config detection. */
  env?: Record<string, string | undefined>;
}

/**
 * Generate both a heuristic and an LLM proposal for the same research
 * snapshot and return a structured comparison.
 *
 * The heuristic path always runs synchronously. The LLM path is async
 * and may itself fall back to heuristic if the API is unavailable or
 * fails — `llmActuallyUsed` tells you which happened.
 */
export async function compareAnalysis(
  research: ResearchSnapshot,
  options: CompareOptions = {},
): Promise<ComparisonResult> {
  const signals = extractSignals(research);

  // Run both paths
  const heuristic = autoDraftProposal(research);
  const llm = await autoDraftProposalWithLLM(research, {
    timeoutMs: options.timeoutMs,
    env: options.env,
  });

  const llmActuallyUsed = llm.usedLLMAnalysis === true;

  const deltas = computeDeltas(heuristic, llm, llmActuallyUsed);

  return {
    symbol: research.symbol,
    timestamp: new Date().toISOString(),
    signals,
    heuristic,
    llm,
    llmActuallyUsed,
    deltas,
  };
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

function computeDeltas(
  heuristic: ProposalResult,
  llm: ProposalResult,
  llmActuallyUsed: boolean,
): ComparisonDeltas {
  const hIntent = heuristic.intent;
  const lIntent = llm.intent;

  const hConf = hIntent?.confidence ?? "low";
  const lConf = lIntent?.confidence ?? "low";

  const hFactors = hIntent?.key_factors ?? [];
  const lFactors = lIntent?.key_factors ?? [];
  const hRisks = hIntent?.key_risks ?? [];
  const lRisks = lIntent?.key_risks ?? [];

  // Find unique factors/risks using normalized comparison
  const normalize = (s: string) => s.toLowerCase().trim();
  const lFactorSet = new Set(lFactors.map(normalize));
  const hFactorSet = new Set(hFactors.map(normalize));
  const lRiskSet = new Set(lRisks.map(normalize));
  const hRiskSet = new Set(hRisks.map(normalize));

  return {
    confidenceDiffers: hConf !== lConf,
    heuristicConfidence: hConf,
    llmConfidence: lConf,

    heuristicThesisLength: hIntent?.thesis?.length ?? 0,
    llmThesisLength: lIntent?.thesis?.length ?? 0,

    heuristicFactorCount: hFactors.length,
    llmFactorCount: lFactors.length,
    heuristicRiskCount: hRisks.length,
    llmRiskCount: lRisks.length,

    heuristicOnlyFactors: hFactors.filter((f) => !lFactorSet.has(normalize(f))),
    llmOnlyFactors: lFactors.filter((f) => !hFactorSet.has(normalize(f))),

    heuristicOnlyRisks: hRisks.filter((r) => !lRiskSet.has(normalize(r))),
    llmOnlyRisks: lRisks.filter((r) => !hRiskSet.has(normalize(r))),

    directionAgrees: (hIntent?.direction ?? "long") === (lIntent?.direction ?? "long"),

    llmTokens: llm.llmTokenUsage?.totalTokens ?? 0,
  };
}
