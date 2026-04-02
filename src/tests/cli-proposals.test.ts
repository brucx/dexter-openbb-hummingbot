/**
 * Tests for the proposal CLI commands and related persistence/format extensions.
 *
 * Tests: updateStatus, enhanced formatProposal (research summary, approval/rejection),
 * formatProposalList (with ID column), and CLI prefix ID resolution.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProposalStore } from "../services/persistence";
import { formatProposal, formatProposalList } from "../services/format";
import type { TradeIntent } from "../types/trade-intent";
import type { ResearchSummary } from "../services/format";

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

// ---- updateStatus -------------------------------------------------------

console.log("=== updateStatus ===\n");

{
  const tmpDir = mkdtempSync(join(tmpdir(), "dexter-cli-test-"));
  const store = createProposalStore(tmpDir);

  try {
    const intent = makeIntent();
    store.save(intent);

    // Approve
    const approved = store.updateStatus(intent.id, { status: "approved" });
    assert(approved !== null, "updateStatus returns updated intent");
    assert(approved!.status === "approved", "status is approved");
    assert(approved!.approved_by === "human", "defaults approved_by to human");
    assert(typeof approved!.approved_at === "string", "sets approved_at timestamp");

    // Verify persisted
    const reloaded = store.load(intent.id);
    assert(reloaded!.status === "approved", "approval persisted to disk");
    assert(reloaded!.approved_by === "human", "approved_by persisted");

    // Reject another proposal
    const intent2 = makeIntent({ id: "bbbb2222-3333-4444-5555-666677778888" });
    store.save(intent2);
    const rejected = store.updateStatus(intent2.id, {
      status: "rejected",
      rejection_reason: "Too risky in current market",
    });
    assert(rejected!.status === "rejected", "status is rejected");
    assert(rejected!.rejection_reason === "Too risky in current market", "rejection reason saved");

    // Reject persisted
    const reloaded2 = store.load(intent2.id);
    assert(reloaded2!.rejection_reason === "Too risky in current market", "rejection persisted");

    // Custom approved_by
    const intent3 = makeIntent({ id: "cccc3333-4444-5555-6666-777788889999" });
    store.save(intent3);
    const custom = store.updateStatus(intent3.id, { status: "approved", approved_by: "alice" });
    assert(custom!.approved_by === "alice", "custom approved_by is respected");

    // Not found
    const missing = store.updateStatus("nonexistent-id", { status: "approved" });
    assert(missing === null, "updateStatus returns null for missing ID");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---- formatProposal with research summary --------------------------------

console.log("\n=== formatProposal with ResearchSummary ===\n");

{
  const summary: ResearchSummary = {
    currentPrice: 185.5,
    dayChange: 2.35,
    dayChangePct: 1.28,
    volume: 54_320_000,
    marketCap: 2_870_000_000_000,
    peRatio: 29.15,
    priceRangeHigh: 192.0,
    priceRangeLow: 171.5,
    newsCount: 5,
  };

  const output = formatProposal(makeIntent(), { researchSummary: summary });
  assert(output.includes("Research snapshot:"), "includes research snapshot header");
  assert(output.includes("$185.5"), "includes current price");
  assert(output.includes("+2.35"), "includes day change");
  assert(output.includes("+1.28%"), "includes day change percent");
  assert(output.includes("54.32M"), "includes formatted volume");
  assert(output.includes("2.87T"), "includes formatted market cap");
  assert(output.includes("P/E: 29.15"), "includes P/E ratio");
  assert(output.includes("$171.5 – $192"), "includes price range");
  assert(output.includes("News articles: 5"), "includes news count");

  // Partial summary (some fields missing)
  const partial: ResearchSummary = { currentPrice: 100, peRatio: 15.2 };
  const partialOutput = formatProposal(makeIntent(), { researchSummary: partial });
  assert(partialOutput.includes("$100"), "partial: includes price");
  assert(partialOutput.includes("P/E: 15.20"), "partial: includes P/E");
  assert(!partialOutput.includes("Volume"), "partial: omits missing volume");
  assert(!partialOutput.includes("Mkt Cap"), "partial: omits missing market cap");
}

// ---- formatProposal with approval/rejection info -------------------------

console.log("\n=== formatProposal with approval/rejection ===\n");

{
  const approved = makeIntent({
    status: "approved",
    approved_by: "human",
    approved_at: "2026-04-01T14:00:00.000Z",
  });
  const output = formatProposal(approved);
  assert(output.includes("Approved by: human"), "shows approved_by");
  assert(output.includes("2026-04-01T14:00:00.000Z"), "shows approved_at");

  const rejected = makeIntent({
    status: "rejected",
    rejection_reason: "Market too volatile",
  });
  const rejOutput = formatProposal(rejected);
  assert(rejOutput.includes("Rejection reason: Market too volatile"), "shows rejection reason");

  // No approval/rejection info for proposed status
  const proposed = makeIntent();
  const propOutput = formatProposal(proposed);
  assert(!propOutput.includes("Approved by"), "no approval info for proposed");
  assert(!propOutput.includes("Rejection reason"), "no rejection info for proposed");
}

// ---- formatProposalList with ID column -----------------------------------

console.log("\n=== formatProposalList with ID ===\n");

{
  const intents = [
    makeIntent(),
    makeIntent({ id: "bbbb2222-3333-4444-5555-666677778888", asset: "TSLA", direction: "short" }),
  ];
  const output = formatProposalList(intents);
  assert(output.includes("ID"), "list header includes ID");
  assert(output.includes("aaaa1111…"), "list includes short ID for first proposal");
  assert(output.includes("bbbb2222…"), "list includes short ID for second proposal");
  assert(output.includes("AAPL"), "list includes AAPL");
  assert(output.includes("TSLA"), "list includes TSLA");
}

// ---- Summary ------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
