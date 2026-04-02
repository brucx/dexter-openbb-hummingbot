#!/usr/bin/env npx tsx
/**
 * research-demo.ts — End-to-end demo of the research → proposal pipeline.
 *
 * Usage:
 *   npx tsx examples/research-demo.ts [SYMBOL]
 *
 * Examples:
 *   npx tsx examples/research-demo.ts          # defaults to AAPL
 *   npx tsx examples/research-demo.ts MSFT
 *
 * This runs the OpenBB bridge (fallback mode if openbb is not installed),
 * fetches a research snapshot, and produces a draft TradeIntent proposal.
 *
 * No real trades are made. No real money is involved.
 */

import { ResearchService } from "../src/services/research";
import { autoDraftProposal } from "../src/services/proposal";
import { createProposalStore } from "../src/services/persistence";
import { formatProposal, formatProposalList } from "../src/services/format";

const symbol = process.argv[2] ?? "AAPL";

console.log(`\n=== Dexter Research Demo ===`);
console.log(`Symbol: ${symbol}\n`);

const service = new ResearchService({
  env: { OPENBB_BRIDGE_MODE: "fallback" }, // force fallback for demo reliability
});

try {
  service.start();

  // Give the bridge a moment to initialize
  await new Promise((r) => setTimeout(r, 500));

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
    if (inc.revenue) console.log(`  Revenue:    $${Number(inc.revenue).toLocaleString()}`);
    if (inc.net_income) console.log(`  Net Income: $${Number(inc.net_income).toLocaleString()}`);
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
    console.log(formatProposal(result.intent));

    if (result.usedFallbackData) {
      console.log(`\n  ⚠ This proposal is based on FALLBACK data, not live market data.`);
    }
    console.log(`\n  This is a PROPOSAL ONLY. No trade has been or will be executed.`);

    // -- Persist --
    console.log(`\n3. Saving proposal to disk...`);
    const store = createProposalStore();
    const path = store.save(result.intent);
    console.log(`  Saved: ${path}`);

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
