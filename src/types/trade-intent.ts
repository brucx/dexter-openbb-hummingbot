/**
 * TradeIntent is the structured format that flows through the entire pipeline.
 * It is the contract between Dexter's research output and Hummingbot's execution input.
 *
 * Every trade proposal — whether it gets approved or not — is represented as a TradeIntent.
 */

export type Direction = "long" | "short";
export type OrderType = "market" | "limit";
export type Confidence = "low" | "medium" | "high";
export type IntentStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "filled"
  | "cancelled";

export interface TradeIntent {
  /** Unique identifier (UUID v4) */
  id: string;

  /** ISO 8601 timestamp of when the proposal was created */
  timestamp: string;

  // -- What --

  /** Trading pair or ticker, e.g., "BTC-USDT" or "AAPL" */
  asset: string;

  /** Trade direction */
  direction: Direction;

  /** Order type */
  order_type: OrderType;

  /** Required if order_type is "limit" */
  limit_price?: number;

  /** Quantity in base asset units */
  quantity: number;

  // -- Risk management --

  /** Stop loss price. Required if safety config demands it. */
  stop_loss?: number;

  /** Take profit price */
  take_profit?: number;

  /** Expected holding period, e.g., "1d", "1w", "1m" */
  time_horizon: string;

  /** Max percentage of portfolio this position should represent */
  max_position_pct: number;

  // -- Reasoning (required — no blind trades) --

  /** One-paragraph investment thesis */
  thesis: string;

  /** Agent's self-assessed confidence */
  confidence: Confidence;

  /** Bullet points supporting the thesis */
  key_factors: string[];

  /** Bullet points on what could go wrong */
  key_risks: string[];

  /** Reference to the Dexter scratchpad entry with full research */
  research_ref: string;

  // -- Lifecycle --

  /** Current status in the pipeline */
  status: IntentStatus;

  /** Who approved (always "human" in this project) */
  approved_by?: string;

  /** ISO 8601 timestamp of approval */
  approved_at?: string;

  /** Hummingbot order ID after execution */
  execution_id?: string;

  /** Reason for rejection, if rejected */
  rejection_reason?: string;
}

/**
 * Validates that a TradeIntent has all required fields and reasonable values.
 * Returns an array of error messages (empty = valid).
 */
export function validateTradeIntent(intent: Partial<TradeIntent>): string[] {
  const errors: string[] = [];

  if (!intent.asset) errors.push("asset is required");
  if (!intent.direction) errors.push("direction is required");
  if (!intent.order_type) errors.push("order_type is required");
  if (intent.order_type === "limit" && intent.limit_price == null) {
    errors.push("limit_price is required for limit orders");
  }
  if (intent.quantity == null || intent.quantity <= 0) {
    errors.push("quantity must be a positive number");
  }
  if (!intent.thesis) errors.push("thesis is required (no blind trades)");
  if (!intent.confidence) errors.push("confidence is required");
  if (!intent.key_factors?.length) {
    errors.push("at least one key_factor is required");
  }
  if (!intent.key_risks?.length) {
    errors.push("at least one key_risk is required");
  }
  if (
    intent.max_position_pct != null &&
    (intent.max_position_pct <= 0 || intent.max_position_pct > 100)
  ) {
    errors.push("max_position_pct must be between 0 and 100");
  }

  return errors;
}
