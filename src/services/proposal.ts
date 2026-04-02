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
}

/**
 * Build a draft TradeIntent from research data and analyst parameters.
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

  const draft: TradeIntent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    asset: input.research.symbol,
    direction: input.direction,
    order_type: input.orderType,
    quantity: input.quantity,
    time_horizon: input.timeHorizon,
    max_position_pct: input.maxPositionPct,
    thesis: input.thesis,
    confidence: input.confidence,
    key_factors: input.keyFactors,
    key_risks: input.keyRisks,
    research_ref: `research-snapshot:${input.research.symbol}:${input.research.timestamp}`,
    status: "proposed",
  };

  // Optional fields
  if (input.limitPrice != null) draft.limit_price = input.limitPrice;
  if (input.stopLoss != null) draft.stop_loss = input.stopLoss;
  if (input.takeProfit != null) draft.take_profit = input.takeProfit;

  const errors = validateTradeIntent(draft);

  if (usedFallbackData) {
    // Not a validation error, but a warning attached to the result
  }

  return {
    intent: errors.length === 0 ? draft : null,
    errors,
    usedFallbackData,
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
    keyRisks: [
      "This is an auto-generated draft — no real analysis was performed",
      "Fallback data may not reflect actual market conditions",
    ],
    ...overrides,
  };

  return buildProposal(defaults);
}
