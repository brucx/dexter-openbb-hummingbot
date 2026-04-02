/**
 * Tests for data quality assessment and graceful degradation in proposal building.
 *
 * Run with: npx tsx src/tests/data-quality.test.ts
 */

import { assessDataQuality, buildProposal, autoDraftProposal } from "../services/proposal";
import type { DataQualityAssessment } from "../services/proposal";
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullLiveSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, isFallback: false },
    priceHistory: {
      symbol,
      records: [{ date: "2024-01-01", open: 180, high: 182, low: 179, close: 181, volume: 50_000_000 }],
      isFallback: false,
    },
    financials: { symbol, period: "annual", incomeStatement: { revenue: 394_328_000_000 }, isFallback: false },
    news: { symbol, articles: [{ title: "AAPL beats earnings" }], isFallback: false },
    errors: [],
    timestamp: new Date().toISOString(),
  };
}

function allFallbackSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, isFallback: true },
    priceHistory: {
      symbol,
      records: [{ date: "2024-01-01", open: 180, high: 182, low: 179, close: 181, volume: 50_000_000 }],
      isFallback: true,
    },
    financials: { symbol, period: "annual", incomeStatement: { revenue: 394_328_000_000 }, isFallback: true },
    news: { symbol, articles: [{ title: "Sample news" }], isFallback: true },
    errors: [],
    timestamp: new Date().toISOString(),
  };
}

function partialSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, isFallback: false },
    priceHistory: null,
    financials: null,
    news: null,
    errors: ["priceHistory: timeout", "financials: provider error"],
    timestamp: new Date().toISOString(),
  };
}

function emptySnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: null,
    priceHistory: null,
    financials: null,
    news: null,
    errors: ["quote: failed", "priceHistory: failed", "financials: failed", "news: failed"],
    timestamp: new Date().toISOString(),
  };
}

function mixedSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, isFallback: false },
    priceHistory: {
      symbol,
      records: [{ date: "2024-01-01", open: 180, high: 182, low: 179, close: 181, volume: 50_000_000 }],
      isFallback: false,
    },
    financials: { symbol, period: "annual", incomeStatement: { revenue: 394_328_000_000 }, isFallback: true },
    news: null,
    errors: ["news: provider unavailable"],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// assessDataQuality tests
// ---------------------------------------------------------------------------

console.log("\n=== assessDataQuality ===\n");

test("all live → max confidence high", () => {
  const dq = assessDataQuality(fullLiveSnapshot());
  assert(dq.maxConfidence === "high", `expected high, got ${dq.maxConfidence}`);
  assert(dq.liveCount === 4, `expected 4 live, got ${dq.liveCount}`);
  assert(dq.fallbackCount === 0, `expected 0 fallback, got ${dq.fallbackCount}`);
  assert(dq.missingCount === 0, `expected 0 missing, got ${dq.missingCount}`);
  assert(dq.dataRisks.length === 0, `expected no data risks, got ${dq.dataRisks.length}`);
});

test("all fallback → max confidence medium", () => {
  const dq = assessDataQuality(allFallbackSnapshot());
  assert(dq.maxConfidence === "medium", `expected medium, got ${dq.maxConfidence}`);
  assert(dq.fallbackCount === 4, `expected 4 fallback, got ${dq.fallbackCount}`);
  assert(dq.dataRisks.length > 0, "should have data risk warnings");
});

test("quote missing → max confidence low", () => {
  const dq = assessDataQuality(emptySnapshot());
  assert(dq.maxConfidence === "low", `expected low, got ${dq.maxConfidence}`);
  assert(dq.missingCount === 4, `expected 4 missing, got ${dq.missingCount}`);
});

test("core source missing → max confidence medium", () => {
  const dq = assessDataQuality(partialSnapshot());
  assert(dq.maxConfidence === "medium", `expected medium, got ${dq.maxConfidence}`);
  assert(dq.sources.quote === "live", "quote should be live");
  assert(dq.sources.priceHistory === "missing", "priceHistory should be missing");
  assert(dq.sources.financials === "missing", "financials should be missing");
});

test("mixed live/fallback/missing → correct counts", () => {
  const dq = assessDataQuality(mixedSnapshot());
  assert(dq.liveCount === 2, `expected 2 live, got ${dq.liveCount}`);
  assert(dq.fallbackCount === 1, `expected 1 fallback, got ${dq.fallbackCount}`);
  assert(dq.missingCount === 1, `expected 1 missing, got ${dq.missingCount}`);
  // financials is fallback (core) → capped to medium
  assert(dq.maxConfidence === "medium", `expected medium, got ${dq.maxConfidence}`);
});

test("news missing alone does not cap below high (supplementary)", () => {
  const snap = fullLiveSnapshot();
  snap.news = null;
  const dq = assessDataQuality(snap);
  // News is supplementary — missing news alone shouldn't cap core confidence
  // But news missing still counts in missingCount
  assert(dq.maxConfidence === "high", `expected high, got ${dq.maxConfidence}`);
  assert(dq.missingCount === 1, `expected 1 missing (news), got ${dq.missingCount}`);
});

test("news fallback alone does not cap below high", () => {
  const snap = fullLiveSnapshot();
  snap.news = { symbol: "AAPL", articles: [{ title: "Sample" }], isFallback: true };
  const dq = assessDataQuality(snap);
  assert(dq.maxConfidence === "high", `expected high, got ${dq.maxConfidence}`);
});

test("specific risk warnings for each missing source", () => {
  const dq = assessDataQuality(emptySnapshot());
  const risks = dq.dataRisks.join("\n");
  assert(risks.includes("No price data"), "should warn about missing price");
  assert(risks.includes("No price history"), "should warn about missing history");
  assert(risks.includes("No financial data"), "should warn about missing financials");
  assert(risks.includes("No news data"), "should warn about missing news");
});

test("specific risk warnings for fallback sources", () => {
  const dq = assessDataQuality(allFallbackSnapshot());
  const risks = dq.dataRisks.join("\n");
  assert(risks.includes("sample/fallback"), "should warn about fallback price");
  assert(risks.includes("sample data"), "should warn about sample data");
});

test("research errors appear as risks", () => {
  const snap = partialSnapshot();
  const dq = assessDataQuality(snap);
  const risks = dq.dataRisks.join("\n");
  assert(risks.includes("Research error: priceHistory: timeout"), "should include research errors");
});

// ---------------------------------------------------------------------------
// buildProposal confidence capping tests
// ---------------------------------------------------------------------------

console.log("\n=== buildProposal confidence capping ===\n");

function makeProposalInput(research: ResearchSnapshot, confidence: "low" | "medium" | "high" = "high") {
  return {
    research,
    direction: "long" as const,
    orderType: "market" as const,
    quantity: 10,
    timeHorizon: "1w",
    maxPositionPct: 3,
    thesis: "Strong fundamentals and momentum.",
    confidence,
    keyFactors: ["Earnings beat", "Good sector"],
    keyRisks: ["Market risk"],
  };
}

test("high confidence preserved with all live data", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot(), "high"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "high", `expected high, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === false, "should not be capped");
});

test("high confidence capped to medium with fallback data", () => {
  const result = buildProposal(makeProposalInput(allFallbackSnapshot(), "high"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "medium", `expected medium, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === true, "should be capped");
});

test("high confidence capped to low when quote missing", () => {
  const result = buildProposal(makeProposalInput(emptySnapshot(), "high"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", `expected low, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === true, "should be capped");
});

test("medium confidence capped to low when quote missing", () => {
  const result = buildProposal(makeProposalInput(emptySnapshot(), "medium"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", `expected low, got ${result.intent!.confidence}`);
});

test("low confidence stays low regardless of data quality", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot(), "low"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", `expected low, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === false, "low can't be capped lower");
});

test("medium stays medium with all live data", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot(), "medium"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "medium", `expected medium, got ${result.intent!.confidence}`);
});

test("medium stays medium with some fallback", () => {
  const result = buildProposal(makeProposalInput(allFallbackSnapshot(), "medium"));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "medium", `expected medium, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === false, "medium <= medium, not capped");
});

// ---------------------------------------------------------------------------
// buildProposal thesis caveat tests
// ---------------------------------------------------------------------------

console.log("\n=== buildProposal thesis caveats ===\n");

test("thesis gets LIMITED DATA caveat when 2+ sources missing", () => {
  const result = buildProposal(makeProposalInput(emptySnapshot()));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.thesis.includes("[LIMITED DATA"), `thesis should have caveat: ${result.intent!.thesis}`);
  assert(result.intent!.thesis.includes("4 of 4"), "should mention count");
});

test("thesis gets WEAK EVIDENCE caveat when 2+ sources are fallback", () => {
  const result = buildProposal(makeProposalInput(allFallbackSnapshot()));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.thesis.includes("[WEAK EVIDENCE"), `thesis should have caveat: ${result.intent!.thesis}`);
});

test("thesis unchanged with all live data", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot()));
  assert(result.intent !== null, "should produce intent");
  assert(!result.intent!.thesis.includes("[LIMITED DATA"), "should not have LIMITED DATA caveat");
  assert(!result.intent!.thesis.includes("[WEAK EVIDENCE"), "should not have WEAK EVIDENCE caveat");
  assert(result.intent!.thesis === "Strong fundamentals and momentum.", "thesis should be unchanged");
});

test("thesis unchanged with single fallback source", () => {
  const snap = fullLiveSnapshot();
  snap.news = { symbol: "AAPL", articles: [{ title: "Sample" }], isFallback: true };
  const result = buildProposal(makeProposalInput(snap));
  assert(result.intent !== null, "should produce intent");
  assert(!result.intent!.thesis.includes("[WEAK EVIDENCE"), "single fallback should not add caveat");
});

test("partial missing (1 source) does not add LIMITED DATA", () => {
  const snap = fullLiveSnapshot();
  snap.news = null;
  const result = buildProposal(makeProposalInput(snap));
  assert(result.intent !== null, "should produce intent");
  assert(!result.intent!.thesis.includes("[LIMITED DATA"), "1 missing should not add caveat");
});

// ---------------------------------------------------------------------------
// buildProposal risk injection tests
// ---------------------------------------------------------------------------

console.log("\n=== buildProposal risk injection ===\n");

test("data-gap risks injected into key_risks", () => {
  const result = buildProposal(makeProposalInput(emptySnapshot()));
  assert(result.intent !== null, "should produce intent");
  const risks = result.intent!.key_risks;
  assert(risks.length > 1, "should have more than original risk");
  assert(risks.some((r) => r.includes("No price data")), "should include price warning");
  assert(risks[0] === "Market risk", "original risk should come first");
});

test("no extra risks with all live data", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot()));
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.key_risks.length === 1, `expected 1 risk, got ${result.intent!.key_risks.length}`);
  assert(result.intent!.key_risks[0] === "Market risk", "should only have original risk");
});

test("fallback risks injected for sample data", () => {
  const result = buildProposal(makeProposalInput(allFallbackSnapshot()));
  assert(result.intent !== null, "should produce intent");
  const risks = result.intent!.key_risks;
  assert(risks.some((r) => r.includes("sample")), "should include sample data warning");
});

test("duplicate risks not added", () => {
  const input = makeProposalInput(emptySnapshot());
  input.keyRisks = ["No price data available — proposal is based on assumed/default pricing", "Other risk"];
  const result = buildProposal(input);
  assert(result.intent !== null, "should produce intent");
  const priceRisks = result.intent!.key_risks.filter((r) => r.includes("No price data"));
  assert(priceRisks.length === 1, `expected 1 price risk, got ${priceRisks.length} (no duplicates)`);
});

// ---------------------------------------------------------------------------
// dataQuality in ProposalResult tests
// ---------------------------------------------------------------------------

console.log("\n=== ProposalResult.dataQuality ===\n");

test("dataQuality attached to result", () => {
  const result = buildProposal(makeProposalInput(fullLiveSnapshot()));
  assert(result.dataQuality !== undefined, "should have dataQuality");
  assert(result.dataQuality.maxConfidence === "high", "should reflect max confidence");
});

test("dataQuality reflects mixed sources", () => {
  const result = buildProposal(makeProposalInput(mixedSnapshot()));
  assert(result.dataQuality.sources.quote === "live", "quote should be live");
  assert(result.dataQuality.sources.financials === "fallback", "financials should be fallback");
  assert(result.dataQuality.sources.news === "missing", "news should be missing");
});

// ---------------------------------------------------------------------------
// autoDraftProposal degradation tests
// ---------------------------------------------------------------------------

console.log("\n=== autoDraftProposal degradation ===\n");

test("auto-draft with all live data stays low confidence", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", "auto-draft is always low");
  assert(result.dataQuality.confidenceWasCapped === false, "low can't be capped");
});

test("auto-draft with empty snapshot produces capped proposal", () => {
  const result = autoDraftProposal(emptySnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", "should be low");
  assert(result.intent!.key_risks.some((r) => r.includes("No price data")), "should warn about missing data");
});

test("auto-draft with fallback data includes sample warnings via dataQuality", () => {
  const result = autoDraftProposal(allFallbackSnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.dataQuality.fallbackCount === 4, "should count all fallback");
  assert(result.intent!.key_risks.some((r) => r.includes("sample")), "should have fallback risk warnings");
});

test("auto-draft override to high confidence is capped with fallback", () => {
  const result = autoDraftProposal(allFallbackSnapshot(), { confidence: "high" });
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "medium", `expected medium, got ${result.intent!.confidence}`);
  assert(result.dataQuality.confidenceWasCapped === true, "should be capped");
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
