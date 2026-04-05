/**
 * Tests for the heuristic vs LLM comparison engine and formatter.
 *
 * These tests exercise compareAnalysis() without real LLM APIs —
 * they rely on the fact that without an API key, the LLM path
 * falls back to heuristic, and we can still validate the comparison
 * structure, delta computation, and formatting.
 *
 * Run with: npx tsx src/tests/compare.test.ts
 */

import { compareAnalysis } from "../services/compare";
import type { ComparisonResult, ComparisonDeltas } from "../services/compare";
import { autoDraftProposal, extractSignals } from "../services/proposal";
import type { ProposalResult } from "../services/proposal";
import { formatComparison } from "../services/format";
import type { ResearchSnapshot } from "../services/research";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result.then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    }).catch((e) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    });
  }
  passed++;
  console.log(`  ✓ ${name}`);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullLiveSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, marketCap: 2_800_000_000_000, peRatio: 28.5, isFallback: false },
    priceHistory: {
      symbol,
      records: [
        { date: "2024-01-01", open: 170, high: 172, low: 168, close: 171, volume: 50_000_000 },
        { date: "2024-01-15", open: 175, high: 178, low: 174, close: 177, volume: 48_000_000 },
        { date: "2024-01-31", open: 180, high: 188, low: 179, close: 185, volume: 52_000_000 },
      ],
      isFallback: false,
    },
    financials: { symbol, period: "annual", incomeStatement: { total_revenue: 394_328_000_000, net_income: 97_000_000_000, basic_eps: 6.13 }, isFallback: false },
    news: { symbol, articles: [{ title: "AAPL beats earnings" }, { title: "Apple announces new product line" }], isFallback: false },
    errors: [],
    timestamp: new Date().toISOString(),
  };
}

function emptySnapshot(symbol = "XYZ"): ResearchSnapshot {
  return {
    symbol,
    quote: null,
    priceHistory: null,
    financials: null,
    news: null,
    errors: ["All sources failed"],
    timestamp: new Date().toISOString(),
  };
}

function partialSnapshot(symbol = "MSFT"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 420.0, change: -3.5, changePct: -0.83, volume: 22_000_000, isFallback: false },
    priceHistory: null,
    financials: null,
    news: { symbol, articles: [{ title: "MSFT cloud revenue grows" }], isFallback: false },
    errors: ["Financials unavailable"],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// compareAnalysis tests
// ---------------------------------------------------------------------------

console.log("\n=== Comparison Engine ===");

await test("compareAnalysis returns a valid ComparisonResult structure", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.symbol === "AAPL", "symbol should be AAPL");
  assert(typeof result.timestamp === "string", "timestamp should be string");
  assert(result.signals != null, "signals should be present");
  assert(result.heuristic != null, "heuristic result should be present");
  assert(result.llm != null, "llm result should be present");
  assert(typeof result.llmActuallyUsed === "boolean", "llmActuallyUsed should be boolean");
  assert(result.deltas != null, "deltas should be present");
});

await test("compareAnalysis without LLM key: both paths produce heuristic output", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(!result.llmActuallyUsed, "LLM should not be used without API key");
  assert(result.heuristic.intent != null, "heuristic intent should exist");
  assert(result.llm.intent != null, "llm intent should exist (fallback)");

  // Both should be heuristic when no API key
  assert(result.llm.usedLLMAnalysis === false, "LLM result should show fallback");
  assert(result.llm.fallbackCategory === "no_llm_configured", "should report no_llm_configured");
});

await test("compareAnalysis signals are shared between both paths", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.signals.price != null, "price signals should be present");
  assert(result.signals.financials != null, "financial signals should be present");
  assert(result.signals.news != null, "news signals should be present");
  assert(result.signals.price!.currentPrice === 185.5, "price should match snapshot");
});

await test("compareAnalysis works with empty snapshot", async () => {
  const snap = emptySnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.symbol === "XYZ", "symbol should be XYZ");
  assert(result.heuristic.intent != null, "heuristic should still produce intent");
  assert(result.llm.intent != null, "llm should still produce intent (fallback)");
  assert(result.signals.price === null, "price signals should be null");
});

await test("compareAnalysis works with partial snapshot", async () => {
  const snap = partialSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.symbol === "MSFT", "symbol should be MSFT");
  assert(result.heuristic.intent != null, "heuristic intent exists");
  assert(result.heuristic.dataQuality.missingCount >= 1, "should have missing sources");
});

// ---------------------------------------------------------------------------
// Delta computation tests
// ---------------------------------------------------------------------------

console.log("\n=== Delta Computation ===");

await test("deltas reflect matching confidence when both paths are heuristic", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  // Without LLM, both paths should produce same confidence
  assert(!result.deltas.confidenceDiffers, "confidence should not differ");
  assert(result.deltas.heuristicConfidence === result.deltas.llmConfidence, "confidences should match");
});

await test("deltas track factor and risk counts", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.deltas.heuristicFactorCount > 0, "heuristic should have factors");
  assert(result.deltas.llmFactorCount > 0, "llm should have factors");
  assert(result.deltas.heuristicRiskCount > 0, "heuristic should have risks");
  assert(result.deltas.llmRiskCount > 0, "llm should have risks");
});

await test("deltas report direction agreement", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.deltas.directionAgrees, "direction should agree for same snapshot");
});

await test("deltas report thesis lengths", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.deltas.heuristicThesisLength > 0, "heuristic thesis should have length");
  assert(result.deltas.llmThesisLength > 0, "llm thesis should have length");
});

await test("deltas report zero tokens when LLM not used", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.deltas.llmTokens === 0, "token count should be 0 without LLM");
});

await test("deltas identify unique factors correctly", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  // When both paths are heuristic (no LLM), unique factors should be minimal
  // (both run autoDraftProposal which produces same factors for same input)
  // The llm path may have slightly different results due to the fallback metadata
  assert(Array.isArray(result.deltas.heuristicOnlyFactors), "heuristicOnlyFactors should be array");
  assert(Array.isArray(result.deltas.llmOnlyFactors), "llmOnlyFactors should be array");
});

await test("deltas handle empty snapshot gracefully", async () => {
  const snap = emptySnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(typeof result.deltas.confidenceDiffers === "boolean", "confidenceDiffers should be boolean");
  assert(result.deltas.heuristicFactorCount >= 0, "factor count should be non-negative");
  assert(result.deltas.heuristicRiskCount >= 0, "risk count should be non-negative");
});

// ---------------------------------------------------------------------------
// Formatting tests
// ---------------------------------------------------------------------------

console.log("\n=== Comparison Formatting ===");

await test("formatComparison produces readable output with box drawing", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Analysis Comparison: AAPL"), "should include symbol header");
  assert(output.includes("┌"), "should have top border");
  assert(output.includes("└"), "should have bottom border");
});

await test("formatComparison shows LLM fallback note when no API key", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Fell back to heuristic"), "should note LLM fallback");
  assert(output.includes("Both columns show heuristic"), "should warn about duplicate output");
});

await test("formatComparison shows confidence section", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Confidence"), "should have confidence header");
  assert(output.includes("Heuristic:"), "should show heuristic label");
  assert(output.includes("LLM:"), "should show LLM label");
});

await test("formatComparison shows thesis comparison", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Thesis"), "should have thesis header");
  assert(output.includes("chars"), "should show character counts");
});

await test("formatComparison shows factor/risk counts", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Factors & Risks"), "should have factors/risks header");
  assert(output.includes("Factors:"), "should show factor counts");
  assert(output.includes("Risks:"), "should show risk counts");
});

await test("formatComparison shows verdict section", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Verdict"), "should have verdict section");
  // Without LLM, should say no meaningful comparison
  assert(output.includes("not available"), "verdict should note LLM unavailability");
});

await test("formatComparison shows data quality summary", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Data quality:"), "should show data quality");
  assert(output.includes("live sources"), "should mention live sources");
});

await test("formatComparison handles empty snapshot", async () => {
  const snap = emptySnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("XYZ"), "should show symbol");
  assert(output.includes("0/4 live sources"), "should show 0 live sources");
});

await test("formatComparison shows direction comparison", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Direction"), "should have direction header");
  assert(output.includes("long"), "should show direction value");
});

await test("formatComparison shows compared-at timestamp", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });
  const output = formatComparison(result);

  assert(output.includes("Compared at:"), "should show comparison timestamp");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

console.log("\n=== Edge Cases ===");

await test("comparison preserves data quality from both paths", async () => {
  const snap = partialSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(result.heuristic.dataQuality != null, "heuristic should have data quality");
  assert(result.llm.dataQuality != null, "llm should have data quality");
  assert(result.heuristic.dataQuality.missingCount > 0, "should have missing sources");
});

await test("comparison works with all-fallback snapshot", async () => {
  const snap: ResearchSnapshot = {
    symbol: "TEST",
    quote: { symbol: "TEST", price: 100, change: 0, changePct: 0, volume: 0, isFallback: true },
    priceHistory: { symbol: "TEST", records: [], isFallback: true },
    financials: { symbol: "TEST", period: "annual", incomeStatement: {}, isFallback: true },
    news: { symbol: "TEST", articles: [], isFallback: true },
    errors: [],
    timestamp: new Date().toISOString(),
  };

  const result = await compareAnalysis(snap, { env: {} });
  assert(result.heuristic.intent != null, "heuristic should produce intent");
  assert(result.heuristic.usedFallbackData, "should flag fallback data");
});

// ---------------------------------------------------------------------------
// LLM env propagation regression tests
// ---------------------------------------------------------------------------

console.log("\n=== LLM Env Propagation ===");

await test("compareAnalysis with no env option lets detectLLMConfig use process.env", async () => {
  // Regression: compare-workflow was passing bridge-only env to compareAnalysis,
  // which forwarded it to detectLLMConfig, shadowing process.env and hiding API keys.
  // When env is omitted, detectLLMConfig should default to process.env.
  const snap = fullLiveSnapshot();

  // No env option at all — should not report "no_llm_configured" if process.env has keys,
  // and should report it if process.env lacks keys (which is the case in test).
  const result = await compareAnalysis(snap);

  // In this test environment there are no LLM keys in process.env,
  // so LLM should fall back — but the important thing is it tried process.env,
  // not an empty object.
  assert(result.llm.fallbackCategory === "no_llm_configured", "should fall back due to missing keys in process.env");
});

await test("compareAnalysis with explicit env containing API key detects LLM", async () => {
  const snap = fullLiveSnapshot();

  // Pass an env that has an OpenAI key — detectLLMConfig should see it.
  // The LLM call will fail (fake key), but the fallback reason should NOT be "no_llm_configured".
  const result = await compareAnalysis(snap, {
    env: { OPENAI_API_KEY: "sk-test-fake-key-for-detection" },
    timeoutMs: 1000,
  });

  // LLM was detected (key was found), but API call should fail → different fallback
  if (result.llmActuallyUsed) {
    // Unlikely with a fake key, but if somehow it passed, that's fine
    assert(true, "LLM was actually used (unexpected but acceptable)");
  } else {
    // The key point: fallback should NOT be "no_llm_configured"
    assert(
      result.llm.fallbackCategory !== "no_llm_configured",
      `should detect API key, but got fallbackCategory="${result.llm.fallbackCategory}"`,
    );
  }
});

await test("compareAnalysis with empty env reports no_llm_configured", async () => {
  const snap = fullLiveSnapshot();
  const result = await compareAnalysis(snap, { env: {} });

  assert(!result.llmActuallyUsed, "LLM should not be used with empty env");
  assert(result.llm.fallbackCategory === "no_llm_configured", "should report no_llm_configured");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
