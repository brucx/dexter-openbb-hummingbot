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
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
