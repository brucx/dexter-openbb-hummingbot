/**
 * Tests for data quality assessment and graceful degradation in proposal building.
 *
 * Run with: npx tsx src/tests/data-quality.test.ts
 */

import { assessDataQuality, buildProposal, autoDraftProposal, extractSignals } from "../services/proposal";
import type { DataQualityAssessment, ResearchSignals } from "../services/proposal";
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
// extractSignals tests
// ---------------------------------------------------------------------------

console.log("\n=== extractSignals ===\n");

test("extracts price signals from live quote + history", () => {
  const signals = extractSignals(fullLiveSnapshot());
  assert(signals.price !== null, "should have price signals");
  assert(signals.price!.currentPrice === 185.5, `expected 185.5, got ${signals.price!.currentPrice}`);
  assert(signals.price!.dayChangePct === 1.28, "should have day change pct");
  assert(signals.price!.volume === 54_321_000, "should have volume");
  assert(signals.price!.marketCap === 2_800_000_000_000, "should have market cap");
  assert(signals.price!.peRatio === 28.5, "should have P/E ratio");
});

test("extracts range from price history", () => {
  const signals = extractSignals(fullLiveSnapshot());
  assert(signals.price!.rangeHigh === 188, `expected rangeHigh 188, got ${signals.price!.rangeHigh}`);
  assert(signals.price!.rangeLow === 168, `expected rangeLow 168, got ${signals.price!.rangeLow}`);
  assert(signals.price!.rangePosition != null, "should compute range position");
  assert(signals.price!.rangePosition! > 0.5, "price should be in upper half of range");
});

test("detects upward trend from price history", () => {
  const signals = extractSignals(fullLiveSnapshot());
  assert(signals.price!.recentTrend === "up", `expected up, got ${signals.price!.recentTrend}`);
  assert(signals.price!.periodChangePct != null, "should compute period change");
  assert(signals.price!.periodChangePct! > 0, "period change should be positive");
});

test("detects downward trend", () => {
  const snap = fullLiveSnapshot();
  snap.priceHistory!.records = [
    { date: "2024-01-01", open: 200, high: 205, low: 198, close: 200, volume: 50_000_000 },
    { date: "2024-01-15", open: 195, high: 197, low: 190, close: 192, volume: 48_000_000 },
    { date: "2024-01-31", open: 185, high: 187, low: 180, close: 182, volume: 52_000_000 },
  ];
  const signals = extractSignals(snap);
  assert(signals.price!.recentTrend === "down", `expected down, got ${signals.price!.recentTrend}`);
  assert(signals.price!.periodChangePct! < 0, "period change should be negative");
});

test("returns null price signals for fallback quote", () => {
  const signals = extractSignals(allFallbackSnapshot());
  assert(signals.price === null, "fallback data should produce null price signals");
});

test("returns null price signals for missing quote", () => {
  const signals = extractSignals(emptySnapshot());
  assert(signals.price === null, "missing data should produce null price signals");
});

test("extracts financial signals from live data", () => {
  const signals = extractSignals(fullLiveSnapshot());
  assert(signals.financials !== null, "should have financial signals");
  assert(signals.financials!.revenue === 394_328_000_000, "should have revenue");
  assert(signals.financials!.netIncome === 97_000_000_000, "should have net income");
  assert(signals.financials!.eps === 6.13, "should have EPS");
  assert(signals.financials!.profitable === true, "should be profitable");
});

test("detects unprofitable company", () => {
  const snap = fullLiveSnapshot();
  snap.financials!.incomeStatement = { total_revenue: 1_000_000, net_income: -500_000 };
  const signals = extractSignals(snap);
  assert(signals.financials!.profitable === false, "should flag as unprofitable");
});

test("returns null financials for fallback data", () => {
  const signals = extractSignals(allFallbackSnapshot());
  assert(signals.financials === null, "fallback financials should be null");
});

test("returns null financials for empty income statement", () => {
  const snap = fullLiveSnapshot();
  snap.financials!.incomeStatement = {};
  const signals = extractSignals(snap);
  assert(signals.financials === null, "empty income statement should produce null");
});

test("extracts news signals from live data", () => {
  const signals = extractSignals(fullLiveSnapshot());
  assert(signals.news !== null, "should have news signals");
  assert(signals.news!.articleCount === 2, `expected 2 articles, got ${signals.news!.articleCount}`);
  assert(signals.news!.headlines.length === 2, "should have 2 headlines");
  assert(signals.news!.hasRecentNews === true, "should have recent news");
});

test("returns null news for fallback data", () => {
  const signals = extractSignals(allFallbackSnapshot());
  assert(signals.news === null, "fallback news should be null");
});

// ---------------------------------------------------------------------------
// autoDraftProposal grounded content tests
// ---------------------------------------------------------------------------

console.log("\n=== autoDraftProposal grounded content ===\n");

test("auto-draft with all live data stays low confidence", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", "auto-draft is always low");
  assert(result.dataQuality.confidenceWasCapped === false, "low can't be capped");
});

test("auto-draft thesis references actual price", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.thesis.includes("185.50"), `thesis should mention price: ${result.intent!.thesis}`);
  assert(result.intent!.thesis.includes("[AUTO-DRAFT]"), "should be marked as auto-draft");
});

test("auto-draft thesis mentions trend when history available", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent!.thesis.includes("upward"), `thesis should mention trend: ${result.intent!.thesis}`);
});

test("auto-draft thesis mentions revenue when financials available", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent!.thesis.includes("Revenue"), `thesis should mention revenue: ${result.intent!.thesis}`);
});

test("auto-draft factors include concrete data points", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  const factors = result.intent!.key_factors;
  assert(factors.some((f) => f.includes("$185.50")), "should have current price");
  assert(factors.some((f) => f.includes("54,321,000") || f.includes("54321000")), "should have volume");
  assert(factors.some((f) => f.includes("$2.80T") || f.includes("market cap")), "should have market cap");
  assert(factors.some((f) => f.includes("28.5")), "should have P/E ratio");
  assert(factors.some((f) => f.includes("30-day range")), "should have price range");
  assert(factors.some((f) => f.includes("Upward")), "should have trend");
});

test("auto-draft factors include financial data points", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  const factors = result.intent!.key_factors;
  assert(factors.some((f) => f.includes("Revenue")), "should have revenue");
  assert(factors.some((f) => f.includes("Net income")), "should have net income");
  assert(factors.some((f) => f.includes("EPS")), "should have EPS");
});

test("auto-draft factors include news coverage", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  const factors = result.intent!.key_factors;
  assert(factors.some((f) => f.includes("article")), "should mention article count");
  assert(factors.some((f) => f.includes("AAPL beats earnings")), "should include top headline");
});

test("auto-draft factors include data source transparency", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  const factors = result.intent!.key_factors;
  assert(factors.some((f) => f.includes("Live data sources")), "should list data sources used");
});

test("auto-draft risks include human-review warning", () => {
  const result = autoDraftProposal(fullLiveSnapshot());
  assert(result.intent!.key_risks.some((r) => r.includes("human review")), "should warn about auto-generated draft");
});

test("auto-draft with empty snapshot has cautious thesis", () => {
  const result = autoDraftProposal(emptySnapshot());
  assert(result.intent !== null, "should produce intent");
  assert(result.intent!.confidence === "low", "should be low");
  assert(result.intent!.thesis.includes("Insufficient"), `thesis should be cautious: ${result.intent!.thesis}`);
  assert(result.intent!.key_risks.some((r) => r.includes("No live price data")), "should warn about missing price data");
});

test("auto-draft with empty snapshot risks mention missing data sources", () => {
  const result = autoDraftProposal(emptySnapshot());
  const risks = result.intent!.key_risks;
  assert(risks.some((r) => r.includes("No live price data")), "should warn about missing price");
  assert(risks.some((r) => r.includes("No live financial data")), "should warn about missing financials");
  assert(risks.some((r) => r.includes("No live news data")), "should warn about missing news");
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

test("auto-draft with downward trend flags risk", () => {
  const snap = fullLiveSnapshot();
  snap.priceHistory!.records = [
    { date: "2024-01-01", open: 200, high: 205, low: 198, close: 200, volume: 50_000_000 },
    { date: "2024-01-15", open: 195, high: 197, low: 190, close: 192, volume: 48_000_000 },
    { date: "2024-01-31", open: 185, high: 187, low: 180, close: 182, volume: 52_000_000 },
  ];
  const result = autoDraftProposal(snap);
  assert(result.intent!.key_risks.some((r) => r.includes("downward")), "should flag downward trend risk");
});

test("auto-draft with high P/E flags risk", () => {
  const snap = fullLiveSnapshot();
  snap.quote!.peRatio = 75;
  const result = autoDraftProposal(snap);
  assert(result.intent!.key_risks.some((r) => r.includes("P/E")), "should flag high P/E risk");
});

test("auto-draft with unprofitable company flags risk", () => {
  const snap = fullLiveSnapshot();
  snap.financials!.incomeStatement = { total_revenue: 1_000_000, net_income: -500_000 };
  const result = autoDraftProposal(snap);
  assert(result.intent!.key_risks.some((r) => r.includes("unprofitable")), "should flag unprofitable company");
  assert(result.intent!.thesis.includes("not currently profitable"), `thesis should mention unprofitability: ${result.intent!.thesis}`);
});

test("auto-draft with partial data (quote only) is cautious but informative", () => {
  const snap = partialSnapshot();
  const result = autoDraftProposal(snap);
  assert(result.intent !== null, "should produce intent");
  // Has quote data, so thesis should mention price
  assert(result.intent!.thesis.includes("185.50"), `should reference price: ${result.intent!.thesis}`);
  // Missing financials/history/news — risks should reflect that
  assert(result.intent!.key_risks.some((r) => r.includes("No live financial data")), "should warn about missing financials");
  assert(result.intent!.key_risks.some((r) => r.includes("No live news data")), "should warn about missing news");
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
