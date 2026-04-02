/**
 * ProposalBuilder — shapes research data into a draft TradeIntent.
 *
 * This is the early Phase 2 piece: given a ResearchSnapshot and some
 * analyst-like parameters, produce a structured TradeIntent in "proposed" status.
 *
 * The builder does NOT execute anything — it only creates proposals for human review.
 */

import { randomUUID } from "node:crypto";
import type { TradeIntent, Direction, OrderType, Confidence } from "../types/trade-intent";
import { validateTradeIntent } from "../types/trade-intent";
import type { ResearchSnapshot } from "./research";

export interface ProposalInput {
  /** The research snapshot to base the proposal on */
  research: ResearchSnapshot;

  /** Trade direction */
  direction: Direction;

  /** Order type */
  orderType: OrderType;

  /** Quantity in base asset units */
  quantity: number;

  /** Limit price (required if orderType is "limit") */
  limitPrice?: number;

  /** Stop loss price */
  stopLoss?: number;

  /** Take profit price */
  takeProfit?: number;

  /** Expected holding period, e.g. "1d", "1w" */
  timeHorizon: string;

  /** Max position as % of portfolio */
  maxPositionPct: number;

  /** One-paragraph thesis */
  thesis: string;

  /** Agent's confidence */
  confidence: Confidence;

  /** Supporting factors */
  keyFactors: string[];

  /** Key risks */
  keyRisks: string[];
}

export interface ProposalResult {
  /** The draft TradeIntent, or null if validation failed */
  intent: TradeIntent | null;

  /** Validation errors, if any */
  errors: string[];

  /** Whether the underlying research used fallback data */
  usedFallbackData: boolean;

  /** Data quality assessment for this proposal */
  dataQuality: DataQualityAssessment;
}

// ---------------------------------------------------------------------------
// Data quality assessment
// ---------------------------------------------------------------------------

export interface DataQualityAssessment {
  /** Maximum confidence justified by available data */
  maxConfidence: Confidence;

  /** Whether the requested confidence was capped */
  confidenceWasCapped: boolean;

  /** Per-source status */
  sources: {
    quote: SourceStatus;
    priceHistory: SourceStatus;
    financials: SourceStatus;
    news: SourceStatus;
  };

  /** Number of sources that are live (not fallback, not missing) */
  liveCount: number;

  /** Number of sources that are fallback/sample */
  fallbackCount: number;

  /** Number of sources that are completely missing */
  missingCount: number;

  /** Auto-generated risk warnings from data gaps */
  dataRisks: string[];
}

export type SourceStatus = "live" | "fallback" | "missing";

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_FROM_RANK: Confidence[] = ["low", "medium", "high"];

/**
 * Assess the quality of a ResearchSnapshot and determine how it should
 * constrain the proposal.
 *
 * Rules (simple and explicit):
 * - Quote missing → max confidence "low" (we don't even know the price)
 * - Any core source missing (quote/history/financials) → max "medium"
 * - All core sources present but any are fallback → max "medium"
 * - All core sources live → max "high" (news is nice-to-have, not gating)
 * - Each gap produces a specific risk warning
 */
export function assessDataQuality(research: ResearchSnapshot): DataQualityAssessment {
  const sourceStatus = (
    data: { isFallback: boolean } | null | undefined,
  ): SourceStatus => {
    if (!data) return "missing";
    return data.isFallback ? "fallback" : "live";
  };

  const sources = {
    quote: sourceStatus(research.quote),
    priceHistory: sourceStatus(research.priceHistory),
    financials: sourceStatus(research.financials),
    news: sourceStatus(research.news),
  };

  const allStatuses = Object.values(sources);
  const liveCount = allStatuses.filter((s) => s === "live").length;
  const fallbackCount = allStatuses.filter((s) => s === "fallback").length;
  const missingCount = allStatuses.filter((s) => s === "missing").length;

  // Core sources are quote, priceHistory, financials — news is supplementary
  const coreSources = [sources.quote, sources.priceHistory, sources.financials];
  const coreMissing = coreSources.filter((s) => s === "missing").length;
  const coreFallback = coreSources.filter((s) => s === "fallback").length;

  // Determine max confidence
  let maxConfidence: Confidence;
  if (sources.quote === "missing") {
    // No price data at all — can't justify any real confidence
    maxConfidence = "low";
  } else if (coreMissing > 0) {
    // Missing core data — cap at medium
    maxConfidence = "medium";
  } else if (coreFallback > 0) {
    // Have all core sources but some are sample data — cap at medium
    maxConfidence = "medium";
  } else {
    // All core sources are live
    maxConfidence = "high";
  }

  // Build specific risk warnings for data gaps
  const dataRisks: string[] = [];

  if (sources.quote === "missing") {
    dataRisks.push("No price data available — proposal is based on assumed/default pricing");
  } else if (sources.quote === "fallback") {
    dataRisks.push("Price data is sample/fallback — does not reflect actual market conditions");
  }

  if (sources.priceHistory === "missing") {
    dataRisks.push("No price history — trend and volatility analysis not possible");
  } else if (sources.priceHistory === "fallback") {
    dataRisks.push("Price history is sample data — trend signals are not meaningful");
  }

  if (sources.financials === "missing") {
    dataRisks.push("No financial data — fundamental analysis not available");
  } else if (sources.financials === "fallback") {
    dataRisks.push("Financial data is sample — valuation metrics are not meaningful");
  }

  if (sources.news === "missing") {
    dataRisks.push("No news data — sentiment and event risk not assessed");
  } else if (sources.news === "fallback") {
    dataRisks.push("News data is sample — sentiment signals are not meaningful");
  }

  // Add research errors as risks
  for (const err of research.errors) {
    dataRisks.push(`Research error: ${err}`);
  }

  return {
    maxConfidence,
    confidenceWasCapped: false, // set by buildProposal after comparing with requested
    sources,
    liveCount,
    fallbackCount,
    missingCount,
    dataRisks,
  };
}

/**
 * Cap a requested confidence to the maximum justified by data quality.
 * Returns the effective confidence (may be lower than requested).
 */
function capConfidence(requested: Confidence, max: Confidence): Confidence {
  const reqRank = CONFIDENCE_RANK[requested];
  const maxRank = CONFIDENCE_RANK[max];
  return CONFIDENCE_FROM_RANK[Math.min(reqRank, maxRank)]!;
}

/**
 * Build a draft TradeIntent from research data and analyst parameters.
 *
 * Applies graceful degradation:
 * - Confidence is capped based on data quality
 * - Data-gap risks are appended to key_risks
 * - Thesis gets a caveat prefix when data is incomplete
 *
 * Returns errors if the proposal doesn't pass validation.
 * The intent is always in "proposed" status — never approved or executing.
 */
export function buildProposal(input: ProposalInput): ProposalResult {
  const usedFallbackData = Boolean(
    input.research.quote?.isFallback ||
    input.research.priceHistory?.isFallback ||
    input.research.financials?.isFallback ||
    input.research.news?.isFallback,
  );

  // Assess data quality and apply degradation
  const dataQuality = assessDataQuality(input.research);
  const effectiveConfidence = capConfidence(input.confidence, dataQuality.maxConfidence);
  dataQuality.confidenceWasCapped = effectiveConfidence !== input.confidence;

  // Build thesis — add caveat when data is incomplete
  let thesis = input.thesis;
  if (dataQuality.missingCount >= 2) {
    thesis = `[LIMITED DATA — ${dataQuality.missingCount} of 4 sources unavailable] ${thesis}`;
  } else if (usedFallbackData && dataQuality.fallbackCount >= 2) {
    thesis = `[WEAK EVIDENCE — based partly on sample data] ${thesis}`;
  }

  // Merge data-gap risks into key_risks (avoid duplicates)
  const existingRisks = new Set(input.keyRisks);
  const mergedRisks = [...input.keyRisks];
  for (const risk of dataQuality.dataRisks) {
    if (!existingRisks.has(risk)) {
      mergedRisks.push(risk);
    }
  }

  const draft: TradeIntent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    asset: input.research.symbol,
    direction: input.direction,
    order_type: input.orderType,
    quantity: input.quantity,
    time_horizon: input.timeHorizon,
    max_position_pct: input.maxPositionPct,
    thesis,
    confidence: effectiveConfidence,
    key_factors: input.keyFactors,
    key_risks: mergedRisks,
    research_ref: `research-snapshot:${input.research.symbol}:${input.research.timestamp}`,
    status: "proposed",
  };

  // Optional fields
  if (input.limitPrice != null) draft.limit_price = input.limitPrice;
  if (input.stopLoss != null) draft.stop_loss = input.stopLoss;
  if (input.takeProfit != null) draft.take_profit = input.takeProfit;

  const errors = validateTradeIntent(draft);

  return {
    intent: errors.length === 0 ? draft : null,
    errors,
    usedFallbackData,
    dataQuality,
  };
}

/**
 * Auto-generate a simple proposal from a research snapshot.
 *
 * This is a convenience function for demo/testing — it fills in reasonable
 * defaults so you can see the full pipeline without manually specifying every field.
 *
 * CLEARLY MARKED: this is not real investment logic.
 */
export function autoDraftProposal(
  research: ResearchSnapshot,
  overrides: Partial<ProposalInput> = {},
): ProposalResult {
  const price = research.quote?.price ?? 100;
  const risks: string[] = [
    "This is an auto-generated draft — no real analysis was performed",
  ];
  const defaults: ProposalInput = {
    research,
    direction: "long",
    orderType: "limit",
    quantity: 1,
    limitPrice: Math.round(price * 100) / 100,
    stopLoss: Math.round(price * 0.95 * 100) / 100,  // 5% stop
    takeProfit: Math.round(price * 1.10 * 100) / 100, // 10% target
    timeHorizon: "1w",
    maxPositionPct: 2,
    thesis: `[AUTO-DRAFT — not real analysis] Based on research snapshot for ${research.symbol}.`,
    confidence: "low",
    keyFactors: [
      `Current price: $${price}`,
      `Research data available: quote=${!!research.quote}, history=${!!research.priceHistory}, financials=${!!research.financials}, news=${!!research.news}`,
    ],
    keyRisks: risks,
    ...overrides,
  };

  return buildProposal(defaults);
}
