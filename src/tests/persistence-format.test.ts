/**
 * Tests for proposal persistence and CLI formatting.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProposalStore } from "../services/persistence";
import { formatProposal, formatProposalList } from "../services/format";
import type { TradeIntent } from "../types/trade-intent";

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
    id: "test-0001-0001-0001-000000000001",
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
    thesis: "Test thesis for AAPL based on strong earnings and momentum.",
    confidence: "medium",
    key_factors: ["Strong Q4 earnings", "Positive momentum"],
    key_risks: ["Market volatility", "Regulatory risk"],
    research_ref: "test-ref",
    status: "proposed",
    ...overrides,
  };
}

// ---- Persistence --------------------------------------------------------

console.log("=== ProposalStore ===\n");

const tmpDir = mkdtempSync(join(tmpdir(), "dexter-test-"));
const store = createProposalStore(tmpDir);

try {
  const intent = makeIntent();
  const path = store.save(intent);
  assert(path.endsWith(".json"), "save returns a .json path");

  const loaded = store.load(intent.id);
  assert(loaded !== null, "load finds saved proposal");
  assert(loaded!.id === intent.id, "loaded ID matches");
  assert(loaded!.asset === "AAPL", "loaded asset matches");
  assert(loaded!.thesis === intent.thesis, "loaded thesis matches");

  const missing = store.load("nonexistent-id");
  assert(missing === null, "load returns null for missing ID");

  // Save a second proposal
  const intent2 = makeIntent({ id: "test-0002-0002-0002-000000000002", asset: "TSLA", timestamp: "2026-04-02T12:00:00.000Z" });
  store.save(intent2);

  const ids = store.list();
  assert(ids.length === 2, "list returns both proposals");

  const all = store.loadAll();
  assert(all.length === 2, "loadAll returns both proposals");
  assert(all[0]!.timestamp >= all[1]!.timestamp, "loadAll sorts by timestamp descending");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ---- Formatting ---------------------------------------------------------

console.log("\n=== formatProposal ===\n");

const intent = makeIntent();
const output = formatProposal(intent);
assert(output.includes("LONG AAPL"), "format includes direction and asset");
assert(output.includes("×10"), "format includes quantity");
assert(output.includes("LIMIT @ $185.5"), "format includes limit price");
assert(output.includes("SL $176.23"), "format includes stop loss");
assert(output.includes("TP $204.05"), "format includes take profit");
assert(output.includes("MEDIUM"), "format includes confidence");
assert(output.includes("proposed"), "format includes status");
assert(output.includes("Test thesis"), "format includes thesis");
assert(output.includes("+ Strong Q4 earnings"), "format includes key factors");
assert(output.includes("- Market volatility"), "format includes key risks");

const marketOrder = formatProposal(makeIntent({ order_type: "market", limit_price: undefined }));
assert(marketOrder.includes("MARKET"), "market order shows MARKET");

// ---- List formatting ----------------------------------------------------

console.log("\n=== formatProposalList ===\n");

const list = formatProposalList([intent, makeIntent({ asset: "TSLA", direction: "short" })]);
assert(list.includes("AAPL"), "list includes AAPL");
assert(list.includes("TSLA"), "list includes TSLA");
assert(list.includes("short"), "list includes direction");

const empty = formatProposalList([]);
assert(empty.includes("No saved"), "empty list shows message");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
