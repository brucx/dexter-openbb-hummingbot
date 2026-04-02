#!/usr/bin/env npx tsx
/**
 * research-demo.ts — End-to-end demo of the research → proposal pipeline.
 *
 * Usage:
 *   npx tsx examples/research-demo.ts [SYMBOL]
 *
 * Environment:
 *   OPENBB_BRIDGE_MODE=auto      (default) try live OpenBB, fall back to sample data
 *   OPENBB_BRIDGE_MODE=live      require live OpenBB (fails if SDK missing)
 *   OPENBB_BRIDGE_MODE=fallback  force deterministic sample data
 *   OPENBB_PYTHON_BIN            path to the Python interpreter with OpenBB installed
 *                                 (default: "python3")
 *
 * Examples:
 *   npx tsx examples/research-demo.ts                          # auto mode, AAPL
 *   npx tsx examples/research-demo.ts MSFT                     # auto mode, MSFT
 *   OPENBB_BRIDGE_MODE=fallback npx tsx examples/research-demo.ts  # force fallback
 *   OPENBB_BRIDGE_MODE=live npx tsx examples/research-demo.ts      # force live
 *
 *   # Use a repo-local virtualenv with OpenBB installed:
 *   OPENBB_PYTHON_BIN=.venv-openbb/bin/python3 OPENBB_BRIDGE_MODE=live npx tsx examples/research-demo.ts
 *
 * No real trades are made. No real money is involved.
 */

import { ResearchService } from "../src/services/research";
import { autoDraftProposal } from "../src/services/proposal";
import { createProposalStore } from "../src/services/persistence";
import { formatProposal, formatProposalList } from "../src/services/format";

const symbol = process.argv[2] ?? "AAPL";
const bridgeMode = process.env.OPENBB_BRIDGE_MODE ?? "auto";
const pythonBin = process.env.OPENBB_PYTHON_BIN;

console.log(`\n=== Dexter Research Demo ===`);
console.log(`Symbol: ${symbol}`);
console.log(`Bridge mode: ${bridgeMode}`);
if (pythonBin) console.log(`Python:      ${pythonBin}`);
console.log();

const env: Record<string, string> = {};
if (bridgeMode !== "auto") {
  env.OPENBB_BRIDGE_MODE = bridgeMode;
}
// In "auto" mode we don't set the env var, so the Python bridge
// will try to import OpenBB and fall back gracefully if unavailable.

const service = new ResearchService({ pythonBin, env });

try {
  service.start();

  // Give the bridge a moment to initialize
  await new Promise((r) => setTimeout(r, 500));

  if (!service.ready) {
    console.error("Bridge process exited during startup.");
    for (const line of service.diagnostics) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }

  console.log("1. Fetching research snapshot...");
  const snapshot = await service.research(symbol);

  // -- Quote --
  if (snapshot.quote) {
    console.log(`\n--- Quote ---`);
    console.log(`  Price:      $${snapshot.quote.price}`);
    console.log(`  Change:     ${snapshot.quote.change > 0 ? "+" : ""}${snapshot.quote.change} (${snapshot.quote.changePct}%)`);
    console.log(`  Volume:     ${snapshot.quote.volume.toLocaleString()}`);
    if (snapshot.quote.isFallback) console.log(`  ⚠ Fallback data (OpenBB SDK not available)`);
  }

  // -- Price History --
  if (snapshot.priceHistory) {
    const records = snapshot.priceHistory.records;
    console.log(`\n--- Price History (${records.length} days) ---`);
    if (records.length > 0) {
      const first = records[0]!;
      const last = records[records.length - 1]!;
      console.log(`  First: ${first.date} close=$${first.close}`);
      console.log(`  Last:  ${last.date} close=$${last.close}`);
    }
    if (snapshot.priceHistory.isFallback) console.log(`  ⚠ Fallback data`);
  }

  // -- Financials --
  if (snapshot.financials) {
    console.log(`\n--- Financials (${snapshot.financials.period}) ---`);
    const inc = snapshot.financials.incomeStatement;
    if (inc.revenue) console.log(`  Revenue:         $${Number(inc.revenue).toLocaleString()}`);
    if (inc.gross_profit) console.log(`  Gross Profit:    $${Number(inc.gross_profit).toLocaleString()}`);
    if (inc.operating_income) console.log(`  Operating Inc:   $${Number(inc.operating_income).toLocaleString()}`);
    if (inc.net_income) console.log(`  Net Income:      $${Number(inc.net_income).toLocaleString()}`);
    if (inc.eps) console.log(`  EPS:             $${Number(inc.eps)}`);
    const bs = snapshot.financials.balanceSheet;
    if (bs) {
      if (bs.total_assets) console.log(`  Total Assets:    $${Number(bs.total_assets).toLocaleString()}`);
      if (bs.total_equity) console.log(`  Total Equity:    $${Number(bs.total_equity).toLocaleString()}`);
    }
    if (snapshot.financials.isFallback) console.log(`  ⚠ Fallback data`);
  }

  // -- News --
  if (snapshot.news) {
    console.log(`\n--- News (${snapshot.news.articles.length} articles) ---`);
    for (const a of snapshot.news.articles) {
      console.log(`  • ${a.title}`);
    }
    if (snapshot.news.isFallback) console.log(`  ⚠ Fallback data`);
  }

  // -- Errors --
  if (snapshot.errors.length > 0) {
    console.log(`\n--- Errors ---`);
    for (const e of snapshot.errors) {
      console.log(`  ✗ ${e}`);
    }
  }

  // -- Proposal --
  console.log(`\n2. Generating draft trade proposal...\n`);
  const result = autoDraftProposal(snapshot);

  if (result.intent) {
    console.log(formatProposal(result.intent, { usedFallbackData: result.usedFallbackData }));
    console.log(`\n  This is a PROPOSAL ONLY. No trade has been or will be executed.`);

    // -- Persist --
    console.log(`\n3. Saving proposal to disk...`);
    const store = createProposalStore();
    const path = store.save(result.intent);
    console.log(`  Saved: ${path}`);
    const rpath = store.saveResearch(result.intent.id, snapshot);
    console.log(`  Research: ${rpath}`);

    const all = store.loadAll();
    console.log(`\n--- Saved Proposals (${all.length} total) ---`);
    console.log(formatProposalList(all));
  } else {
    console.log(`\n  ✗ Proposal failed validation:`);
    for (const e of result.errors) {
      console.log(`    - ${e}`);
    }
  }

  console.log(`\n=== Demo complete ===\n`);
} finally {
  service.stop();
}
