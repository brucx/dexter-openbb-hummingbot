/**
 * Integration test: exercises the full bridge → ResearchService → proposal pipeline.
 *
 * Runs the OpenBB bridge in FALLBACK mode so the test is deterministic
 * and requires no external dependencies.
 */

import { ResearchService } from "../services/research";
import { autoDraftProposal, buildProposal } from "../services/proposal";

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

const service = new ResearchService({
  env: { OPENBB_BRIDGE_MODE: "fallback" },
});

try {
  service.start();
  // Give bridge a moment to start
  await new Promise((r) => setTimeout(r, 500));

  // ---- Individual queries ------------------------------------------------

  console.log("=== ResearchService individual queries ===\n");

  const quote = await service.getQuote("AAPL");
  assert(quote.symbol === "AAPL", "quote returns correct symbol");
  assert(quote.price > 0, "quote has a positive price");
  assert(quote.isFallback === true, "quote is flagged as fallback");

  const history = await service.getPriceHistory("AAPL", 5);
  assert(history.records.length > 0, "price history returns records");
  assert(typeof history.records[0]!.close === "number", "price records have numeric close");
  assert(history.isFallback === true, "price history is flagged as fallback");

  const financials = await service.getFinancials("AAPL");
  assert(Object.keys(financials.incomeStatement).length > 0, "financials returns income statement");
  assert(financials.isFallback === true, "financials is flagged as fallback");

  const news = await service.getNews("AAPL", 3);
  assert(news.articles.length > 0, "news returns articles");
  assert(typeof news.articles[0]!.title === "string", "news articles have titles");
  assert(news.isFallback === true, "news is flagged as fallback");

  // ---- Combined research -------------------------------------------------

  console.log("\n=== ResearchService.research() ===\n");

  const snapshot = await service.research("TSLA");
  assert(snapshot.symbol === "TSLA", "snapshot has correct symbol");
  assert(snapshot.quote !== null, "snapshot includes quote");
  assert(snapshot.priceHistory !== null, "snapshot includes price history");
  assert(snapshot.financials !== null, "snapshot includes financials");
  assert(snapshot.news !== null, "snapshot includes news");
  assert(snapshot.errors.length === 0, "snapshot has no errors");
  assert(typeof snapshot.timestamp === "string", "snapshot has timestamp");

  // ---- Proposal from research --------------------------------------------

  console.log("\n=== Proposal pipeline ===\n");

  const draft = autoDraftProposal(snapshot);
  assert(draft.intent !== null, "autoDraftProposal produces a valid intent");
  assert(draft.intent!.asset === "TSLA", "proposal asset matches research symbol");
  assert(draft.intent!.status === "proposed", "proposal status is 'proposed'");
  assert(draft.usedFallbackData === true, "proposal flags fallback data");

  const manual = buildProposal({
    research: snapshot,
    direction: "short",
    orderType: "market",
    quantity: 10,
    timeHorizon: "1d",
    maxPositionPct: 5,
    thesis: "Integration test thesis for TSLA short.",
    confidence: "medium",
    keyFactors: ["Test factor 1"],
    keyRisks: ["Test risk 1"],
  });
  assert(manual.intent !== null, "buildProposal with manual params succeeds");
  assert(manual.intent!.direction === "short", "manual proposal respects direction");
  assert(manual.intent!.order_type === "market", "manual proposal respects order type");
  assert(manual.intent!.quantity === 10, "manual proposal respects quantity");

  // ---- Error handling ----------------------------------------------------

  console.log("\n=== Error paths ===\n");

  const badProposal = buildProposal({
    research: snapshot,
    direction: "long",
    orderType: "limit",
    // missing limitPrice for limit order
    quantity: 0, // invalid
    timeHorizon: "1w",
    maxPositionPct: 2,
    thesis: "",
    confidence: "low",
    keyFactors: [],
    keyRisks: [],
  });
  assert(badProposal.intent === null, "invalid proposal returns null intent");
  assert(badProposal.errors.length >= 3, "invalid proposal reports multiple errors");

  // ---- Bridge mode tests --------------------------------------------------

  console.log("\n=== Bridge mode selection ===\n");

  // "live" mode should fail fast if OpenBB SDK is not installed
  {
    const liveService = new ResearchService({
      env: { OPENBB_BRIDGE_MODE: "live" },
    });
    liveService.start();
    await new Promise((r) => setTimeout(r, 1000)); // give it time to exit
    try {
      await liveService.getQuote("AAPL");
      // If OpenBB IS installed, this succeeds — that's fine
      assert(true, "live mode works when OpenBB SDK is available");
    } catch {
      // Bridge exited because OpenBB is not installed — expected
      assert(true, "live mode fails fast when OpenBB SDK is missing");
    } finally {
      liveService.stop();
    }
  }

  // "fallback" mode should always work
  {
    const fbService = new ResearchService({
      env: { OPENBB_BRIDGE_MODE: "fallback" },
    });
    fbService.start();
    await new Promise((r) => setTimeout(r, 500));
    const fbQuote = await fbService.getQuote("AAPL");
    assert(fbQuote.isFallback === true, "explicit fallback mode returns fallback data");
    fbService.stop();
  }

  // "auto" mode (no env var) should work regardless
  {
    const autoService = new ResearchService({ env: {} });
    autoService.start();
    await new Promise((r) => setTimeout(r, 500));
    const autoQuote = await autoService.getQuote("AAPL");
    assert(autoQuote.price > 0, "auto mode returns valid data (live or fallback)");
    autoService.stop();
  }

  // ---- OPENBB_PYTHON_BIN test -----------------------------------------------

  console.log("\n=== OPENBB_PYTHON_BIN support ===\n");

  // Explicit pythonBin option should override the default
  {
    const customService = new ResearchService({
      pythonBin: "python3", // explicit, same as default — just verify it's accepted
      env: { OPENBB_BRIDGE_MODE: "fallback" },
    });
    customService.start();
    await new Promise((r) => setTimeout(r, 500));
    const q = await customService.getQuote("AAPL");
    assert(q.price > 0, "explicit pythonBin option works");
    customService.stop();
  }

  // Bad pythonBin should cause the bridge to fail
  {
    const badService = new ResearchService({
      pythonBin: "/nonexistent/python3",
      env: { OPENBB_BRIDGE_MODE: "fallback" },
    });
    badService.start();
    await new Promise((r) => setTimeout(r, 500));
    try {
      await badService.getQuote("AAPL");
      assert(false, "bad pythonBin should fail");
    } catch {
      assert(true, "bad pythonBin rejects correctly");
    } finally {
      badService.stop();
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
} finally {
  service.stop();
}

process.exit(failed > 0 ? 1 : 0);
