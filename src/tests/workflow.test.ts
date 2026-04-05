/**
 * Tests for the trade analysis workflow (analyzeSymbol).
 *
 * These tests exercise the workflow orchestration layer without starting a
 * real bridge — they use a mock ProposalStore and test the function's contract
 * by validating the shape of AnalyzeResult from autoDraftProposal directly,
 * plus the CLI command structure.
 *
 * Run with: npx tsx src/tests/workflow.test.ts
 */

import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { autoDraftProposal } from "../services/proposal";
import { createProposalStore } from "../services/persistence";
import { analyzeSymbol } from "../services/workflow";
import { formatProposal } from "../services/format";
import type { ProposalStore } from "../services/persistence";
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
    errors: ["priceHistory: timeout", "financials: unavailable"],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join(tmpdir(), `dexter-test-workflow-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests: Workflow produces valid results
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: proposal generation ===\n");

test("full live snapshot generates a valid proposal", () => {
  const snap = fullLiveSnapshot("AAPL");
  const result = autoDraftProposal(snap);
  assert(result.intent !== null, "intent should not be null");
  assert(result.intent!.asset === "AAPL", "asset should be AAPL");
  assert(result.intent!.status === "proposed", "status should be proposed");
  assert(result.errors.length === 0, "should have no errors");
});

test("fallback snapshot generates a proposal with degraded confidence", () => {
  const snap = allFallbackSnapshot("MSFT");
  const result = autoDraftProposal(snap);
  assert(result.intent !== null, "intent should not be null");
  assert(result.intent!.asset === "MSFT", "asset should be MSFT");
  assert(result.usedFallbackData === true, "should flag fallback data");
  assert(result.dataQuality.fallbackCount > 0, "should have fallback sources");
});

test("partial snapshot still produces a proposal", () => {
  const snap = partialSnapshot("TSLA");
  const result = autoDraftProposal(snap);
  assert(result.intent !== null, "intent should not be null");
  assert(result.intent!.asset === "TSLA", "asset should be TSLA");
  assert(result.dataQuality.missingCount >= 2, "should have missing sources");
});

test("data quality assessment is always present", () => {
  const snap = fullLiveSnapshot();
  const result = autoDraftProposal(snap);
  assert(result.dataQuality !== undefined, "dataQuality should be present");
  assert(typeof result.dataQuality.maxConfidence === "string", "maxConfidence should be a string");
  assert(typeof result.dataQuality.liveCount === "number", "liveCount should be a number");
});

test("proposal has required fields for review", () => {
  const snap = fullLiveSnapshot();
  const result = autoDraftProposal(snap);
  const intent = result.intent!;
  assert(typeof intent.id === "string" && intent.id.length > 0, "should have id");
  assert(typeof intent.thesis === "string" && intent.thesis.length > 0, "should have thesis");
  assert(intent.key_factors.length > 0, "should have key_factors");
  assert(intent.key_risks.length > 0, "should have key_risks");
  assert(typeof intent.confidence === "string", "should have confidence");
  assert(typeof intent.research_ref === "string", "should have research_ref");
});

// ---------------------------------------------------------------------------
// Tests: Persistence integration
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: persistence ===\n");

test("proposal + research sidecar can be saved and loaded", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("AAPL");
    const result = autoDraftProposal(snap);
    assert(result.intent !== null, "intent should not be null");

    const proposalPath = store.save(result.intent!);
    const researchPath = store.saveResearch(result.intent!.id, snap);

    assert(existsSync(proposalPath), "proposal file should exist");
    assert(existsSync(researchPath), "research file should exist");

    const loaded = store.load(result.intent!.id);
    assert(loaded !== null, "should load proposal back");
    assert(loaded!.asset === "AAPL", "loaded asset should match");

    const loadedResearch = store.loadResearch(result.intent!.id);
    assert(loadedResearch !== null, "should load research back");
    assert(loadedResearch!.symbol === "AAPL", "loaded research symbol should match");
  } finally {
    cleanup(dir);
  }
});

test("multiple proposals are listed after save", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);

    const snap1 = fullLiveSnapshot("AAPL");
    const r1 = autoDraftProposal(snap1);
    store.save(r1.intent!);

    const snap2 = fullLiveSnapshot("MSFT");
    const r2 = autoDraftProposal(snap2);
    store.save(r2.intent!);

    const all = store.loadAll();
    assert(all.length === 2, `should have 2 proposals, got ${all.length}`);
  } finally {
    cleanup(dir);
  }
});

test("saved proposal can be approved via updateStatus", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("AAPL");
    const result = autoDraftProposal(snap);
    store.save(result.intent!);

    const updated = store.updateStatus(result.intent!.id, { status: "approved" });
    assert(updated !== null, "updateStatus should return intent");
    assert(updated!.status === "approved", "status should be approved");
    assert(updated!.approved_by === "human", "approved_by should be human");
    assert(typeof updated!.approved_at === "string", "approved_at should be set");

    // Reload from disk to verify persistence
    const reloaded = store.load(result.intent!.id);
    assert(reloaded!.status === "approved", "persisted status should be approved");
  } finally {
    cleanup(dir);
  }
});

test("saved proposal can be rejected with reason", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("AAPL");
    const result = autoDraftProposal(snap);
    store.save(result.intent!);

    const updated = store.updateStatus(result.intent!.id, {
      status: "rejected",
      rejection_reason: "Insufficient momentum",
    });
    assert(updated !== null, "updateStatus should return intent");
    assert(updated!.status === "rejected", "status should be rejected");
    assert(updated!.rejection_reason === "Insufficient momentum", "reason should be set");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Tests: End-to-end workflow shape
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: end-to-end shape ===\n");

test("full workflow produces result with all expected fields", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("GOOG");
    const proposal = autoDraftProposal(snap);

    // Simulate what analyzeSymbol does
    let proposalPath: string | null = null;
    let researchPath: string | null = null;
    let shortId: string | null = null;

    if (proposal.intent) {
      proposalPath = store.save(proposal.intent);
      researchPath = store.saveResearch(proposal.intent.id, snap);
      shortId = proposal.intent.id.slice(0, 8);
    }

    assert(proposal.intent !== null, "intent should not be null");
    assert(proposalPath !== null, "proposalPath should not be null");
    assert(researchPath !== null, "researchPath should not be null");
    assert(shortId !== null && shortId.length === 8, "shortId should be 8 chars");
    assert(proposal.intent!.asset === "GOOG", "asset should be GOOG");
    assert(proposal.dataQuality.maxConfidence === "high", "live data should allow high confidence");
  } finally {
    cleanup(dir);
  }
});

test("workflow with degraded data caps confidence and adds risks", () => {
  const snap = partialSnapshot("NFLX");
  const proposal = autoDraftProposal(snap);

  assert(proposal.intent !== null, "intent should not be null");
  assert(proposal.dataQuality.missingCount >= 2, "should have missing sources");
  assert(proposal.intent!.thesis.includes("[LIMITED DATA"), "thesis should have caveat");

  const hasDataRisk = proposal.intent!.key_risks.some(
    (r) => r.includes("history") || r.includes("financial") || r.includes("news"),
  );
  assert(hasDataRisk, "should have data-gap risk warnings");
});

test("workflow with all fallback marks usedFallbackData", () => {
  const snap = allFallbackSnapshot("AMZN");
  const proposal = autoDraftProposal(snap);

  assert(proposal.usedFallbackData === true, "should flag fallback");
  assert(proposal.dataQuality.fallbackCount === 4, "all 4 sources should be fallback");
  assert(
    proposal.dataQuality.maxConfidence === "medium" || proposal.dataQuality.maxConfidence === "low",
    "confidence should be capped",
  );
});

test("short ID is deterministic from intent ID", () => {
  const snap = fullLiveSnapshot();
  const result = autoDraftProposal(snap);
  const shortId = result.intent!.id.slice(0, 8);
  assert(result.intent!.id.startsWith(shortId), "shortId should be prefix of full ID");
});

// ---------------------------------------------------------------------------
// Tests: analyzeSymbol entrypoint
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: analyzeSymbol entrypoint ===\n");

/**
 * Minimal mock that satisfies the ResearchService interface used by analyzeSymbol.
 * Returns a canned snapshot without spawning a real bridge process.
 */
function createMockService(snapshot: ResearchSnapshot) {
  return {
    start() {},
    stop() {},
    get ready() { return true; },
    get diagnostics() { return [] as string[]; },
    async research(_symbol: string) { return snapshot; },
  } as any; // cast — analyzeSymbol only uses start/stop/ready/diagnostics/research
}

test("analyzeSymbol returns structured result with all fields", async () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("NVDA");
    const mockService = createMockService(snap);

    const result = await analyzeSymbol({
      symbol: "NVDA",
      store,
      service: mockService,
    });

    assert(result.symbol === "NVDA", "symbol should be NVDA");
    assert(result.research === snap, "research should be the snapshot");
    assert(result.proposal !== undefined, "proposal should be present");
    assert(result.intent !== null, "intent should not be null for live data");
    assert(result.intent!.asset === "NVDA", "intent asset should be NVDA");
    assert(typeof result.shortId === "string" && result.shortId!.length === 8, "shortId should be 8 chars");
    assert(result.proposalPath !== null, "proposalPath should not be null");
    assert(result.researchPath !== null, "researchPath should not be null");
    assert(existsSync(result.proposalPath!), "proposal file should exist on disk");
    assert(existsSync(result.researchPath!), "research file should exist on disk");
  } finally {
    cleanup(dir);
  }
});

test("analyzeSymbol with degraded data returns capped confidence", async () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = partialSnapshot("META");
    const mockService = createMockService(snap);

    const result = await analyzeSymbol({
      symbol: "META",
      store,
      service: mockService,
    });

    assert(result.intent !== null, "intent should not be null");
    assert(result.proposal.dataQuality.missingCount >= 2, "should have missing sources");
    assert(result.intent!.thesis.includes("[LIMITED DATA"), "thesis should have caveat");
  } finally {
    cleanup(dir);
  }
});

test("analyzeSymbol with failed bridge throws descriptive error", async () => {
  const failService = {
    start() {},
    stop() {},
    get ready() { return false; },
    get diagnostics() { return ["ImportError: No module named 'openbb'"]; },
    async research() { throw new Error("not reachable"); },
  } as any;

  let threw = false;
  try {
    await analyzeSymbol({ symbol: "FAIL", service: failService });
  } catch (err) {
    threw = true;
    const msg = (err as Error).message;
    assert(msg.includes("Bridge process exited"), "should mention bridge exit");
    assert(msg.includes("openbb"), "should include diagnostic output");
  }
  assert(threw, "should have thrown an error");
});

// ---------------------------------------------------------------------------
// Tests: CLI command structure
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: CLI structure ===\n");

test("CLI usage text includes analyze command", async () => {
  // Read the CLI source to verify the analyze command is registered
  const { readFileSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const cliSrc = readFileSync(pathJoin("src", "cli.ts"), "utf-8");

  assert(cliSrc.includes('domain === "analyze"'), "CLI should handle analyze command");
  assert(cliSrc.includes("analyzeSymbol"), "CLI should use analyzeSymbol");
  assert(cliSrc.includes("Next steps:"), "CLI should show next steps guidance");
  assert(cliSrc.includes("proposals show"), "Next steps should mention proposals show");
  assert(cliSrc.includes("proposals approve"), "Next steps should mention proposals approve");
  assert(cliSrc.includes("proposals reject"), "Next steps should mention proposals reject");
});

test("CLI rejects flag-like input as symbol", async () => {
  const { readFileSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const cliSrc = readFileSync(pathJoin("src", "cli.ts"), "utf-8");

  assert(cliSrc.includes('symbol.startsWith("-")'), "CLI should guard against flag-like symbols");
});

test("CLI usage text includes workflow description", async () => {
  const { readFileSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const cliSrc = readFileSync(pathJoin("src", "cli.ts"), "utf-8");

  assert(cliSrc.includes("Workflow:"), "usage should include Workflow section");
  assert(cliSrc.includes("dexter analyze"), "usage should show analyze command");
});

test("CLI supports 'a' shorthand for analyze", async () => {
  const { readFileSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const cliSrc = readFileSync(pathJoin("src", "cli.ts"), "utf-8");

  assert(cliSrc.includes('domain === "a"'), "CLI should support 'a' shorthand");
});

// ---------------------------------------------------------------------------
// Tests: Workflow spec document
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: spec document ===\n");

test("WORKFLOW.md exists and describes the pipeline", async () => {
  const { readFileSync, existsSync: exists } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const path = pathJoin("docs", "WORKFLOW.md");

  assert(exists(path), "docs/WORKFLOW.md should exist");
  const content = readFileSync(path, "utf-8");
  assert(content.includes("Gather Research"), "should describe research step");
  assert(content.includes("Assess Data Quality"), "should describe quality step");
  assert(content.includes("Generate Proposal"), "should describe proposal step");
  assert(content.includes("Persist"), "should describe persistence step");
  assert(content.includes("Review in CLI"), "should describe review step");
  assert(content.includes("analyzeSymbol"), "should mention programmatic API");
});

// ---------------------------------------------------------------------------
// Tests: LLM metadata persistence
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: LLM metadata persistence ===\n");

test("analyzeSymbol persists heuristic analysis metadata on intent", async () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("AAPL");
    const mockService = createMockService(snap);

    const result = await analyzeSymbol({
      symbol: "AAPL",
      store,
      service: mockService,
      useLLM: false, // force heuristic
    });

    assert(result.intent !== null, "intent should not be null");
    assert(result.intent!.analysis_llm === false, "analysis_llm should be false for heuristic");
    assert(result.intent!.analysis_model === undefined, "analysis_model should be undefined for heuristic");
    assert(result.intent!.analysis_tokens === undefined, "analysis_tokens should be undefined for heuristic");

    // Verify it round-trips through persistence
    const loaded = store.load(result.intent!.id);
    assert(loaded !== null, "should reload from disk");
    assert(loaded!.analysis_llm === false, "persisted analysis_llm should be false");
    assert(loaded!.analysis_model === undefined, "persisted analysis_model should be undefined");
    assert(loaded!.analysis_tokens === undefined, "persisted analysis_tokens should be undefined");
  } finally {
    cleanup(dir);
  }
});

test("heuristic proposal has no analysis_tokens or analysis_model", async () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = allFallbackSnapshot("TSLA");
    const mockService = createMockService(snap);

    const result = await analyzeSymbol({
      symbol: "TSLA",
      store,
      service: mockService,
      useLLM: false,
    });

    assert(result.intent !== null, "intent should not be null");
    // Heuristic path should NOT populate LLM-specific fields
    assert(result.intent!.analysis_model === undefined, "no model for heuristic");
    assert(result.intent!.analysis_tokens === undefined, "no tokens for heuristic");
  } finally {
    cleanup(dir);
  }
});

test("older proposals without analysis metadata load cleanly", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    // Simulate an older proposal saved without analysis_* fields
    const snap = fullLiveSnapshot("GOOG");
    const result = autoDraftProposal(snap);
    assert(result.intent !== null, "intent should not be null");

    // Save without stamping metadata (simulates pre-metadata proposal)
    store.save(result.intent!);
    const loaded = store.load(result.intent!.id);
    assert(loaded !== null, "should load old proposal");
    assert(loaded!.analysis_llm === undefined, "analysis_llm should be undefined for old proposal");
    assert(loaded!.analysis_model === undefined, "analysis_model should be undefined for old proposal");
    assert(loaded!.analysis_tokens === undefined, "analysis_tokens should be undefined for old proposal");
  } finally {
    cleanup(dir);
  }
});

test("LLM metadata fields round-trip through persistence correctly", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("MSFT");
    const result = autoDraftProposal(snap);
    const intent = result.intent!;

    // Manually stamp LLM metadata (simulates what workflow does for LLM path)
    intent.analysis_llm = true;
    intent.analysis_model = "gpt-5.4";
    intent.analysis_tokens = { prompt: 845, completion: 389, total: 1234 };

    store.save(intent);
    const loaded = store.load(intent.id);
    assert(loaded !== null, "should load");
    assert(loaded!.analysis_llm === true, "analysis_llm should round-trip");
    assert(loaded!.analysis_model === "gpt-5.4", "analysis_model should round-trip");
    assert(loaded!.analysis_tokens!.prompt === 845, "prompt tokens should round-trip");
    assert(loaded!.analysis_tokens!.completion === 389, "completion tokens should round-trip");
    assert(loaded!.analysis_tokens!.total === 1234, "total tokens should round-trip");
  } finally {
    cleanup(dir);
  }
});

test("fallback metadata round-trips through persistence", () => {
  const dir = tmpDir();
  try {
    const store = createProposalStore(dir);
    const snap = fullLiveSnapshot("AMZN");
    const result = autoDraftProposal(snap);
    const intent = result.intent!;

    // Simulate a fallback scenario
    intent.analysis_llm = false;
    intent.analysis_fallback_category = "api_error";
    intent.analysis_fallback_detail = "Request timed out after 30000ms";

    store.save(intent);
    const loaded = store.load(intent.id);
    assert(loaded !== null, "should load");
    assert(loaded!.analysis_llm === false, "analysis_llm should be false");
    assert(loaded!.analysis_fallback_category === "api_error", "fallback_category should round-trip");
    assert(loaded!.analysis_fallback_detail === "Request timed out after 30000ms", "fallback_detail should round-trip");
    assert(loaded!.analysis_tokens === undefined, "no tokens for fallback");
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Tests: CLI proposals show reconstructs analysis mode
// ---------------------------------------------------------------------------

console.log("\n=== Workflow: proposals show analysis mode reconstruction ===\n");

test("CLI source reconstructs AnalysisModeInfo from persisted intent", async () => {
  const { readFileSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const cliSrc = readFileSync(pathJoin("src", "cli.ts"), "utf-8");

  assert(cliSrc.includes("analysis_llm"), "proposals show should read analysis_llm from intent");
  assert(cliSrc.includes("analysis_model"), "proposals show should read analysis_model from intent");
  assert(cliSrc.includes("analysis_tokens"), "proposals show should read analysis_tokens from intent");
  assert(cliSrc.includes("analysisMode"), "proposals show should pass analysisMode to formatProposal");
});

test("formatProposal shows persisted LLM metadata", () => {
  // formatProposal imported at top of file
  const intent = {
    id: "test-llm-meta-0001",
    timestamp: "2026-04-05T10:00:00.000Z",
    asset: "NVDA",
    direction: "long",
    order_type: "market",
    quantity: 5,
    time_horizon: "1w",
    max_position_pct: 3,
    thesis: "Strong momentum driven by AI demand cycle.",
    confidence: "high",
    key_factors: ["Revenue growth"],
    key_risks: ["Valuation"],
    research_ref: "test-ref",
    status: "proposed",
    analysis_llm: true,
    analysis_model: "gpt-5.4",
    analysis_tokens: { prompt: 800, completion: 350, total: 1150 },
  };

  const analysisMode = {
    usedLLM: intent.analysis_llm,
    model: intent.analysis_model,
    tokenUsage: { promptTokens: 800, completionTokens: 350, totalTokens: 1150 },
  };

  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("LLM (gpt-5.4)"), "should show LLM model name");
  assert(output.includes("1,150"), "should show total tokens");
  assert(output.includes("800"), "should show prompt tokens");
  assert(output.includes("350"), "should show completion tokens");
});

test("formatProposal shows heuristic fallback from persisted metadata", () => {
  // formatProposal imported at top of file
  const intent = {
    id: "test-heuristic-meta-0001",
    timestamp: "2026-04-05T10:00:00.000Z",
    asset: "TSLA",
    direction: "short",
    order_type: "market",
    quantity: 3,
    time_horizon: "1d",
    max_position_pct: 2,
    thesis: "Weak momentum signals.",
    confidence: "low",
    key_factors: ["Declining volume"],
    key_risks: ["Squeeze risk"],
    research_ref: "test-ref",
    status: "proposed",
    analysis_llm: false,
    analysis_fallback_category: "api_error",
    analysis_fallback_detail: "Request timed out",
  };

  const analysisMode = {
    usedLLM: false,
    fallbackReason: intent.analysis_fallback_detail,
  };

  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Heuristic"), "should show Heuristic");
  assert(output.includes("Request timed out"), "should show fallback reason");
  assert(!output.includes("Tokens:"), "should NOT show tokens for heuristic");
});

test("formatProposal gracefully handles proposal without analysis metadata", () => {
  // formatProposal imported at top of file
  const intent = {
    id: "test-old-0001",
    timestamp: "2026-03-01T10:00:00.000Z",
    asset: "AAPL",
    direction: "long",
    order_type: "limit",
    limit_price: 180,
    quantity: 10,
    time_horizon: "1w",
    max_position_pct: 2,
    thesis: "Old proposal without analysis metadata.",
    confidence: "medium",
    key_factors: ["Factor"],
    key_risks: ["Risk"],
    research_ref: "test-ref",
    status: "proposed",
  };

  // No analysisMode passed — simulates old proposal without metadata
  const output = formatProposal(intent);
  assert(!output.includes("Analysis:"), "should NOT show analysis line for old proposals");
  assert(!output.includes("Tokens:"), "should NOT show tokens for old proposals");
  assert(output.includes("AAPL"), "should still show the proposal content");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
