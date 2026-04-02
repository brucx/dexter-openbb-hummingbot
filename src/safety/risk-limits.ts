/**
 * Safety wrapper — validates TradeIntents against configured risk limits.
 *
 * This is the gate between "agent proposes" and "human reviews."
 * A proposal that fails safety checks never reaches the approval prompt.
 *
 * Placeholder for Phase 4 implementation. The interface is defined;
 * the implementation is stubbed.
 */

import type { TradeIntent } from "../types/trade-intent";

export interface RiskLimits {
  max_position_pct: number;
  max_order_value_usd: number;
  max_orders_per_hour: number;
  daily_loss_limit_usd: number;
  require_stop_loss: boolean;
  require_reasoning: boolean;
}

export interface AssetLimits {
  allowed: string[];
  blocked: string[];
}

export interface SafetyConfig {
  limits: RiskLimits;
  assets: AssetLimits;
}

export interface SafetyCheckResult {
  passed: boolean;
  violations: string[];
}

/**
 * Validate a TradeIntent against safety configuration.
 * Returns a result indicating whether the proposal passed all checks,
 * and if not, which specific limits were violated.
 */
export function checkSafety(
  intent: TradeIntent,
  config: SafetyConfig,
  _portfolioState: { total_value_usd: number; orders_this_hour: number; daily_pnl_usd: number },
): SafetyCheckResult {
  const violations: string[] = [];

  // Asset whitelist check
  if (config.assets.allowed.length > 0 && !config.assets.allowed.includes(intent.asset)) {
    violations.push(`Asset ${intent.asset} is not in the allowed list`);
  }

  // Asset blacklist check
  if (config.assets.blocked.includes(intent.asset)) {
    violations.push(`Asset ${intent.asset} is blocked`);
  }

  // Position size check
  if (intent.max_position_pct > config.limits.max_position_pct) {
    violations.push(
      `Position size ${intent.max_position_pct}% exceeds limit of ${config.limits.max_position_pct}%`,
    );
  }

  // Stop loss check
  if (config.limits.require_stop_loss && intent.stop_loss == null) {
    violations.push("Stop loss is required but not provided");
  }

  // Reasoning check
  if (config.limits.require_reasoning && (!intent.thesis || !intent.key_factors?.length)) {
    violations.push("Research reasoning is required but not provided");
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
