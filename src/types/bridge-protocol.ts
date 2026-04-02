/**
 * Bridge protocol types for communication between TypeScript (Dexter) and
 * Python (OpenBB / Hummingbot) processes.
 *
 * Communication happens via JSON Lines over stdin/stdout.
 * Each line is a complete JSON object — one request or one response.
 */

// -- OpenBB Bridge --

export type OpenBBMethod =
  | "price_history"
  | "quote"
  | "financials"
  | "news"
  | "technicals"
  | "estimates"
  | "screen"
  | "macro";

export interface OpenBBRequest {
  /** Unique request ID for correlating responses */
  id: string;

  /** Which OpenBB function to call */
  method: OpenBBMethod;

  /** Method-specific parameters */
  params: Record<string, unknown>;
}

export interface OpenBBResponse {
  /** Matches the request ID */
  id: string;

  /** Null on success, error message on failure */
  error: string | null;

  /** Response data (shape depends on method) */
  data: unknown;

  /** Which OpenBB provider fulfilled the request */
  provider?: string;
}

// -- Hummingbot Bridge --

export type HummingbotMethod =
  | "place_order"
  | "cancel_order"
  | "get_balances"
  | "get_positions"
  | "get_order_status";

export interface HummingbotRequest {
  id: string;
  method: HummingbotMethod;
  params: Record<string, unknown>;
}

export interface HummingbotResponse {
  id: string;
  error: string | null;
  data: unknown;
}

/** Execution events streamed from Hummingbot bridge (unsolicited, no request ID) */
export interface ExecutionEvent {
  event_type:
    | "order_placed"
    | "order_filled"
    | "order_cancelled"
    | "order_failed"
    | "balance_changed";
  timestamp: string;
  payload: Record<string, unknown>;
}
