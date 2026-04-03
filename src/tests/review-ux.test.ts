/**
 * Tests for proposal review UX enhancements:
 * - Research snapshot sidecar persistence
 * - buildResearchSummary extractor
 * - Enriched formatProposal (financials, news, data availability)
 * - formatProposalList with price context
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProposalStore } from "../services/persistence";
import {
  formatProposal,
  formatProposalList,
  buildResearchSummary,
} from "../services/format";
import type { ResearchSummary, ListPriceContext } from "../services/format";
import type { TradeIntent } from "../types/trade-intent";
import type { ResearchSnapshot } from "../services/research";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

function makeIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
  return {
    id: "aaaa1111-2222-3333-4444-555566667777",
    timestamp: "2026-04-01T12:00:00.000Z",
    asset: "AAPL",
    direction: "long",
    order_type: "limit",
    limit_price: 185.5,
    quantity: 10,
    stop_loss: 176.23,
    take_profit: 204.05,
    time_horizon: "1w",
    max_position_pct: 2,
    thesis: "Strong earnings momentum and positive technical setup.",
    confidence: "medium",
    key_factors: ["Strong Q4 earnings", "Positive momentum"],
    key_risks: ["Market volatility", "Regulatory risk"],
    research_ref: "test-ref",
    status: "proposed",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ResearchSnapshot> = {}): ResearchSnapshot {
  return {
    symbol: "AAPL",
    quote: {
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 185.5,
      change: 2.35,
      changePct: 1.28,
      volume: 54_320_000,
      marketCap: 2_870_000_000_000,
      peRatio: 29.15,
      isFallback: false,
    },
    priceHistory: {
      symbol: "AAPL",
      records: [
        { date: "2026-03-01", open: 170, high: 175, low: 168, close: 171.5, volume: 50_000_000 },
        { date: "2026-03-15", open: 178, high: 192, low: 177, close: 189, volume: 55_000_000 },
        { date: "2026-04-01", open: 184, high: 188, low: 182, close: 185.5, volume: 54_320_000 },
      ],
      isFallback: false,
    },
    financials: {
      symbol: "AAPL",
      period: "annual",
      incomeStatement: {
        revenue: 394_330_000_000,
        gross_profit: 170_780_000_000,
        net_income: 97_000_000_000,
        eps: 6.13,
      },
      balanceSheet: { total_assets: 352_580_000_000 },
      isFallback: false,
    },
    news: {
      symbol: "AAPL",
      articles: [
        { title: "Apple Q1 earnings beat expectations", source: "Reuters" },
        { title: "iPhone sales surge in China", source: "Bloomberg" },
        { title: "Apple announces new AI features", source: "TechCrunch" },
        { title: "Apple Vision Pro sales disappoint", source: "WSJ" },
      ],
      isFallback: false,
    },
    errors: [],
    timestamp: "2026-04-01T11:00:00.000Z",
    ...overrides,
  };
}

// ---- Research sidecar persistence -----------------------------------------

console.log("=== Research sidecar persistence ===\n");

{
  const tmpDir = mkdtempSync(join(tmpdir(), "dexter-review-ux-"));
  const store = createProposalStore(tmpDir);

  try {
    const intent = makeIntent();
    store.save(intent);

    const snapshot = makeSnapshot();
    const rpath = store.saveResearch(intent.id, snapshot);
    assert(rpath.endsWith(".research.json"), "saveResearch returns .research.json path");

    const loaded = store.loadResearch(intent.id);
    assert(loaded !== null, "loadResearch finds saved snapshot");
    assert(loaded!.symbol === "AAPL", "loaded snapshot has correct symbol");
    assert(loaded!.quote!.price === 185.5, "loaded snapshot has correct price");
    assert(loaded!.financials!.incomeStatement.revenue === 394_330_000_000, "loaded snapshot has financials");
    assert(loaded!.news!.articles.length === 4, "loaded snapshot has news articles");
    assert(loaded!.errors.length === 0, "loaded snapshot has no errors");

    // Missing sidecar
    const missing = store.loadResearch("nonexistent-id");
    assert(missing === null, "loadResearch returns null for missing ID");

    // Sidecar doesn't interfere with proposal listing
    const ids = store.list();
    assert(ids.length === 1, "list still returns only proposal IDs (not sidecars)");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- buildResearchSummary -------------------------------------------------

console.log("\n=== buildResearchSummary ===\n");

{
  // Full snapshot
  const snapshot = makeSnapshot();
  const summary = buildResearchSummary(snapshot);

  assert(summary.currentPrice === 185.5, "extracts current price");
  assert(summary.dayChange === 2.35, "extracts day change");
  assert(summary.dayChangePct === 1.28, "extracts day change pct");
  assert(summary.volume === 54_320_000, "extracts volume");
  assert(summary.marketCap === 2_870_000_000_000, "extracts market cap");
  assert(summary.peRatio === 29.15, "extracts P/E ratio");
  assert(summary.priceRangeLow === 171.5, "extracts 30d low from price history");
  assert(summary.priceRangeHigh === 189, "extracts 30d high from price history");
  assert(summary.revenue === 394_330_000_000, "extracts revenue");
  assert(summary.netIncome === 97_000_000_000, "extracts net income");
  assert(summary.eps === 6.13, "extracts EPS");
  assert(summary.financialsPeriod === "annual", "extracts financials period");
  assert(summary.newsHeadlines!.length === 3, "extracts top 3 news headlines");
  assert(summary.newsHeadlines![0] === "Apple Q1 earnings beat expectations", "first headline correct");
  assert(summary.newsCount === 4, "news count is total articles");
  assert(summary.researchTimestamp === "2026-04-01T11:00:00.000Z", "extracts timestamp");

  // Data availability — all live
  const da = summary.dataAvailability!;
  assert(da.quote === "live", "quote status is live");
  assert(da.priceHistory === "live", "priceHistory status is live");
  assert(da.financials === "live", "financials status is live");
  assert(da.news === "live", "news status is live");
  assert(da.errors === undefined, "no errors in availability");
}

{
  // Partial snapshot — no news, fallback financials, errors
  const snapshot = makeSnapshot({
    news: null,
    financials: {
      symbol: "AAPL",
      period: "annual",
      incomeStatement: { revenue: 100_000_000 },
      isFallback: true,
    },
    errors: ["news: provider timeout"],
  });
  const summary = buildResearchSummary(snapshot);

  assert(summary.newsHeadlines === undefined, "no headlines when news is null");
  assert(summary.newsCount === undefined, "no news count when news is null");
  assert(summary.revenue === 100_000_000, "fallback financials still extracted");
  assert(summary.netIncome === undefined, "missing net income is undefined");

  const da = summary.dataAvailability!;
  assert(da.news === "unavailable", "news status is unavailable");
  assert(da.financials === "fallback", "financials status is fallback");
  assert(da.quote === "live", "quote still live");
  assert(da.errors!.length === 1, "errors passed through");
  assert(da.errors![0] === "news: provider timeout", "error message preserved");
}

{
  // Empty snapshot — everything null
  const snapshot = makeSnapshot({
    quote: null,
    priceHistory: null,
    financials: null,
    news: null,
    errors: ["quote: failed", "priceHistory: failed", "financials: failed", "news: failed"],
  });
  const summary = buildResearchSummary(snapshot);

  assert(summary.currentPrice === undefined, "no price when quote null");
  assert(summary.priceRangeLow === undefined, "no range when history null");
  assert(summary.revenue === undefined, "no revenue when financials null");
  assert(summary.newsCount === undefined, "no news count when news null");

  const da = summary.dataAvailability!;
  assert(da.quote === "unavailable", "all sources unavailable");
  assert(da.priceHistory === "unavailable", "priceHistory unavailable");
  assert(da.financials === "unavailable", "financials unavailable");
  assert(da.news === "unavailable", "news unavailable");
  assert(da.errors!.length === 4, "all errors preserved");
}

// ---- Live-but-empty financials consistency in UI ----------------------------

console.log("\n=== Live-but-empty financials in UI ===\n");

{
  // Live financials with empty income statement should show as "--" not "OK"
  const snapshot = makeSnapshot({
    financials: { symbol: "AAPL", period: "annual", incomeStatement: {}, isFallback: false },
  });
  const summary = buildResearchSummary(snapshot);
  const da = summary.dataAvailability!;
  assert(da.financials === "unavailable", "live-but-empty financials should be unavailable");

  const output = formatProposal(makeIntent(), { researchSummary: summary });
  assert(output.includes("Financials: --"), "live-but-empty financials should show as --");
  assert(!output.includes("Financials: OK"), "should NOT show Financials: OK when income statement is empty");
}

{
  // Live financials with content should still show as "OK"
  const snapshot = makeSnapshot();
  const summary = buildResearchSummary(snapshot);
  const da = summary.dataAvailability!;
  assert(da.financials === "live", "financials with content should remain live");
}

// ---- Zero day-change display -----------------------------------------------

console.log("\n=== Zero day-change display ===\n");

{
  const snapshot = makeSnapshot({
    quote: {
      symbol: "AAPL",
      price: 185.5,
      change: 0,
      changePct: 0,
      volume: 54_320_000,
      isFallback: false,
    },
  });
  const summary = buildResearchSummary(snapshot);
  const output = formatProposal(makeIntent(), { researchSummary: summary });
  assert(output.includes("(unchanged)"), "zero day change should show as unchanged");
  assert(!output.includes("+0.00%"), "should not show +0.00%");
}

{
  // Non-zero change should still show percentage
  const snapshot = makeSnapshot();
  const summary = buildResearchSummary(snapshot);
  const output = formatProposal(makeIntent(), { researchSummary: summary });
  assert(output.includes("+1.28%"), "non-zero change should show percentage");
}

// ---- Enriched formatProposal display --------------------------------------

console.log("\n=== Enriched formatProposal ===\n");

{
  const snapshot = makeSnapshot();
  const summary = buildResearchSummary(snapshot);
  const output = formatProposal(makeIntent(), { researchSummary: summary });

  // Financials section
  assert(output.includes("Financials (annual):"), "shows financials header with period");
  assert(output.includes("Revenue:"), "shows revenue label");
  assert(output.includes("394.33B"), "shows formatted revenue");
  assert(output.includes("Net Income:"), "shows net income label");
  assert(output.includes("EPS:        $6.13"), "shows EPS");

  // News headlines
  assert(output.includes("Recent news:"), "shows news header");
  assert(output.includes("• Apple Q1 earnings beat expectations"), "shows first headline");
  assert(output.includes("• iPhone sales surge in China"), "shows second headline");
  assert(output.includes("• Apple announces new AI features"), "shows third headline");
  assert(output.includes("(1 more)"), "shows remaining count");

  // Data sources
  assert(output.includes("Data sources:"), "shows data sources header");
  assert(output.includes("Quote: OK"), "shows quote as OK");
  assert(output.includes("History: OK"), "shows history as OK");
  assert(output.includes("Financials: OK"), "shows financials as OK");
  assert(output.includes("News: OK"), "shows news as OK");

  // Research timestamp
  assert(output.includes("2026-04-01 11:00"), "shows research timestamp");
}

{
  // Partial data — shows SAMPLE and -- indicators
  const snapshot = makeSnapshot({
    news: null,
    financials: { symbol: "AAPL", period: "annual", incomeStatement: {}, isFallback: true },
    errors: ["news: no provider keys configured"],
  });
  const summary = buildResearchSummary(snapshot);
  const output = formatProposal(makeIntent(), { researchSummary: summary });

  assert(output.includes("Financials: SAMPLE"), "shows fallback as SAMPLE");
  assert(output.includes("News: --"), "shows unavailable as --");
  assert(output.includes("! news: no provider keys configured"), "shows error detail");
  assert(!output.includes("Recent news:"), "no news section when unavailable");
}

// ---- formatProposalList with price context --------------------------------

console.log("\n=== formatProposalList with price context ===\n");

{
  const intents = [
    makeIntent(),
    makeIntent({ id: "bbbb2222-3333-4444-5555-666677778888", asset: "TSLA", direction: "short" }),
  ];

  const priceCtx: ListPriceContext = new Map([
    ["aaaa1111-2222-3333-4444-555566667777", { price: 185.5, changePct: 1.28 }],
    ["bbbb2222-3333-4444-5555-666677778888", { price: 245.0, changePct: -2.1 }],
  ]);

  const output = formatProposalList(intents, priceCtx);
  assert(output.includes("Price"), "header includes Price column");
  assert(output.includes("$185.5"), "shows AAPL price");
  assert(output.includes("+1.3%"), "shows positive change");
  assert(output.includes("$245"), "shows TSLA price");
  assert(output.includes("-2.1%"), "shows negative change");

  // Without price context — falls back to Qty column
  const noCtx = formatProposalList(intents);
  assert(noCtx.includes("Qty"), "without ctx shows Qty header");
  assert(!noCtx.includes("Price"), "without ctx no Price header");
}

{
  // Partial price context — only some proposals have prices
  const intents = [
    makeIntent(),
    makeIntent({ id: "bbbb2222-3333-4444-5555-666677778888", asset: "TSLA" }),
  ];
  const priceCtx: ListPriceContext = new Map([
    ["aaaa1111-2222-3333-4444-555566667777", { price: 185.5 }],
  ]);
  const output = formatProposalList(intents, priceCtx);
  assert(output.includes("$185.5"), "shows price for proposal with context");
  assert(output.includes("—"), "shows dash for proposal without context");
}

// ---- Summary --------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
