/**
 * Tests for TradeIntent validation and proposal building.
 *
 * Run with: npx tsx src/tests/validate-trade-intent.test.ts
 *
 * Uses a minimal test runner (no dependencies) — just assert + process.exit.
 */

import { validateTradeIntent } from "../types/trade-intent";
import type { TradeIntent } from "../types/trade-intent";
import { buildProposal, autoDraftProposal } from "../services/proposal";
import type { ResearchSnapshot } from "../services/research";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertIncludes(arr: string[], substr: string, msg: string) {
  if (!arr.some((s) => s.includes(substr))) {
    throw new Error(`${msg} — expected array to include entry containing "${substr}", got: ${JSON.stringify(arr)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validIntent(): TradeIntent {
  return {
    id: "test-id",
    timestamp: new Date().toISOString(),
    asset: "BTC-USDT",
    direction: "long",
    order_type: "limit",
    limit_price: 50000,
    quantity: 0.1,
    stop_loss: 48000,
    take_profit: 55000,
    time_horizon: "1w",
    max_position_pct: 5,
    thesis: "BTC showing strong momentum after breaking resistance.",
    confidence: "medium",
    key_factors: ["Broke $49k resistance", "Volume increasing"],
    key_risks: ["Regulatory uncertainty", "Possible retracement"],
    research_ref: "research:btc:2024-01-01",
    status: "proposed",
  };
}

function mockResearchSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: {
      symbol,
      price: 185.5,
      change: 2.35,
      changePct: 1.28,
      volume: 54_321_000,
      isFallback: true,
    },
    priceHistory: {
      symbol,
      records: [
        { date: "2024-01-01", open: 180, high: 182, low: 179, close: 181, volume: 50000000 },
      ],
      isFallback: true,
    },
    financials: {
      symbol,
      period: "annual",
      incomeStatement: { revenue: 394_328_000_000 },
      isFallback: true,
    },
    news: {
      symbol,
      articles: [{ title: "Test Article" }],
      isFallback: true,
    },
    errors: [],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// validateTradeIntent tests
// ---------------------------------------------------------------------------

console.log("\n=== validateTradeIntent ===\n");

test("valid intent passes", () => {
  const errors = validateTradeIntent(validIntent());
  assert(errors.length === 0, `Expected no errors, got: ${JSON.stringify(errors)}`);
});

test("missing asset", () => {
  const i = { ...validIntent(), asset: "" };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "asset", "should report missing asset");
});

test("missing direction", () => {
  const i = { ...validIntent() };
  // @ts-expect-error intentional
  delete i.direction;
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "direction", "should report missing direction");
});

test("limit order without price", () => {
  const i = { ...validIntent(), limit_price: undefined };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "limit_price", "should require limit_price for limit orders");
});

test("market order without limit_price is fine", () => {
  const i = { ...validIntent(), order_type: "market" as const, limit_price: undefined };
  const errors = validateTradeIntent(i);
  assert(errors.length === 0, `Expected no errors, got: ${JSON.stringify(errors)}`);
});

test("zero quantity", () => {
  const i = { ...validIntent(), quantity: 0 };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "quantity", "should report invalid quantity");
});

test("negative quantity", () => {
  const i = { ...validIntent(), quantity: -1 };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "quantity", "should report invalid quantity");
});

test("missing thesis", () => {
  const i = { ...validIntent(), thesis: "" };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "thesis", "should report missing thesis");
});

test("empty key_factors", () => {
  const i = { ...validIntent(), key_factors: [] };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "key_factor", "should report missing key_factors");
});

test("empty key_risks", () => {
  const i = { ...validIntent(), key_risks: [] };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "key_risk", "should report missing key_risks");
});

test("max_position_pct out of range (>100)", () => {
  const i = { ...validIntent(), max_position_pct: 101 };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "max_position_pct", "should report invalid max_position_pct");
});

test("max_position_pct out of range (0)", () => {
  const i = { ...validIntent(), max_position_pct: 0 };
  const errors = validateTradeIntent(i);
  assertIncludes(errors, "max_position_pct", "should report invalid max_position_pct");
});

test("multiple errors at once", () => {
  const errors = validateTradeIntent({});
  assert(errors.length >= 5, `Expected at least 5 errors for empty object, got ${errors.length}`);
});

// ---------------------------------------------------------------------------
// buildProposal tests
// ---------------------------------------------------------------------------

console.log("\n=== buildProposal ===\n");

test("builds valid proposal from research", () => {
  const research = mockResearchSnapshot();
  const result = buildProposal({
    research,
    direction: "long",
    orderType: "limit",
    quantity: 10,
    limitPrice: 185,
    stopLoss: 175,
    takeProfit: 200,
    timeHorizon: "1w",
    maxPositionPct: 3,
    thesis: "Strong earnings, good momentum.",
    confidence: "medium",
    keyFactors: ["Earnings beat", "Sector rotation"],
    keyRisks: ["Valuation stretched"],
  });

  assert(result.intent !== null, "should produce a valid intent");
  assert(result.errors.length === 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
  assert(result.intent!.status === "proposed", "status should be proposed");
  assert(result.intent!.asset === "AAPL", "asset should match research symbol");
  assert(result.usedFallbackData === true, "should flag fallback data");
});

test("rejects proposal with missing fields", () => {
  const research = mockResearchSnapshot();
  const result = buildProposal({
    research,
    direction: "long",
    orderType: "limit",
    quantity: 0, // invalid
    timeHorizon: "1w",
    maxPositionPct: 3,
    thesis: "", // invalid
    confidence: "medium",
    keyFactors: [],  // invalid
    keyRisks: ["something"],
  });

  assert(result.intent === null, "should not produce intent when validation fails");
  assert(result.errors.length >= 2, `expected multiple errors, got ${result.errors.length}`);
});

test("proposal status is always 'proposed'", () => {
  const research = mockResearchSnapshot();
  const result = buildProposal({
    research,
    direction: "short",
    orderType: "market",
    quantity: 5,
    timeHorizon: "1d",
    maxPositionPct: 2,
    thesis: "Short-term mean reversion expected.",
    confidence: "low",
    keyFactors: ["Overbought RSI"],
    keyRisks: ["Trend continuation"],
  });
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.status === "proposed", "must be proposed");
  assert(result.intent!.approved_by === undefined, "must not be approved");
});

// ---------------------------------------------------------------------------
// autoDraftProposal tests
// ---------------------------------------------------------------------------

console.log("\n=== autoDraftProposal ===\n");

test("auto-draft produces a valid proposal", () => {
  const research = mockResearchSnapshot("TSLA");
  const result = autoDraftProposal(research);

  assert(result.intent !== null, "should produce a valid intent");
  assert(result.errors.length === 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
  assert(result.intent!.asset === "TSLA", "asset should match");
  assert(result.intent!.confidence === "low", "auto-draft confidence should be low");
  assert(result.intent!.thesis.includes("AUTO-DRAFT"), "thesis should be marked as auto-draft");
  assert(result.usedFallbackData === true, "should flag fallback data");
});

test("auto-draft respects overrides (confidence capped by data quality)", () => {
  const research = mockResearchSnapshot();
  const result = autoDraftProposal(research, {
    direction: "short",
    confidence: "high",
    quantity: 100,
  });

  assert(result.intent !== null, "should produce a valid intent");
  assert(result.intent!.direction === "short", "should respect direction override");
  // Fixture uses all-fallback data → high is capped to medium
  assert(result.intent!.confidence === "medium", "high capped to medium with fallback data");
  assert(result.dataQuality.confidenceWasCapped === true, "should flag that confidence was capped");
  assert(result.intent!.quantity === 100, "should respect quantity override");
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
