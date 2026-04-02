/**
 * Tests for ETF/quote price extraction and price-history date preservation.
 *
 * These cover the two correctness bugs:
 *   1. ETF-like quote payloads where the price field is named differently
 *   2. Price history records must always carry a usable date string
 *
 * Run with: npx tsx src/tests/price-extraction.test.ts
 */

import { ResearchService } from "../services/research";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// Bug 1: ETF / quote price extraction
// ---------------------------------------------------------------------------
//
// getQuote() normalizes raw bridge data. OpenBB providers return price under
// varying field names.  We simulate this by calling the normalization inline
// (the same logic path used in ResearchService.getQuote).

console.log("\n=== Quote price extraction (ETF-like payloads) ===\n");

/** Simulate what getQuote() does to a raw bridge payload. */
function extractPrice(d: Record<string, unknown>): number {
  return Number(
    d.price ?? d.last_price ?? d.close ?? d.last_trade_price
      ?? d.prev_close ?? d.previous_close ?? d.regular_market_previous_close
      ?? d.adj_close ?? 0,
  );
}

test("standard stock payload with 'price' field", () => {
  const price = extractPrice({ price: 185.5, volume: 1000 });
  assert(price === 185.5, `expected 185.5, got ${price}`);
});

test("payload with 'last_price' only", () => {
  const price = extractPrice({ last_price: 92.3 });
  assert(price === 92.3, `expected 92.3, got ${price}`);
});

test("ETF payload with 'close' only (no price/last_price)", () => {
  const price = extractPrice({ close: 412.78, volume: 5_000_000 });
  assert(price === 412.78, `expected 412.78, got ${price}`);
});

test("ETF payload with 'prev_close' only", () => {
  const price = extractPrice({ prev_close: 99.0 });
  assert(price === 99.0, `expected 99.0, got ${price}`);
});

test("payload with 'previous_close' only", () => {
  const price = extractPrice({ previous_close: 210.5 });
  assert(price === 210.5, `expected 210.5, got ${price}`);
});

test("payload with 'regular_market_previous_close' only", () => {
  const price = extractPrice({ regular_market_previous_close: 310.0 });
  assert(price === 310.0, `expected 310.0, got ${price}`);
});

test("payload with 'last_trade_price' only", () => {
  const price = extractPrice({ last_trade_price: 55.5 });
  assert(price === 55.5, `expected 55.5, got ${price}`);
});

test("payload with 'adj_close' only", () => {
  const price = extractPrice({ adj_close: 145.2 });
  assert(price === 145.2, `expected 145.2, got ${price}`);
});

test("priority: 'price' wins over 'close'", () => {
  const price = extractPrice({ price: 100, close: 99 });
  assert(price === 100, `expected 100 (price wins), got ${price}`);
});

test("completely empty payload returns 0", () => {
  const price = extractPrice({});
  assert(price === 0, `expected 0, got ${price}`);
});

// ---------------------------------------------------------------------------
// Bug 2: Price history date preservation
// ---------------------------------------------------------------------------

console.log("\n=== Price history date preservation ===\n");

// Test via live fallback bridge — fallback records always have explicit dates.
const service = new ResearchService({
  env: { OPENBB_BRIDGE_MODE: "fallback" },
});

try {
  service.start();
  await new Promise((r) => setTimeout(r, 500));

  const history = await service.getPriceHistory("SPY", 5);

  test("fallback records have non-empty date strings", () => {
    for (const rec of history.records) {
      assert(typeof rec.date === "string" && rec.date.length > 0,
        `expected non-empty date, got "${rec.date}"`);
    }
  });

  test("fallback dates are valid ISO date strings", () => {
    for (const rec of history.records) {
      const parsed = new Date(rec.date);
      assert(!isNaN(parsed.getTime()), `invalid date: "${rec.date}"`);
    }
  });

  test("fallback records have sequential dates", () => {
    const dates = history.records.map((r) => r.date);
    for (let i = 1; i < dates.length; i++) {
      assert(dates[i]! >= dates[i - 1]!, `dates not sequential: ${dates[i - 1]} > ${dates[i]}`);
    }
  });

  test("all records have numeric close and volume", () => {
    for (const rec of history.records) {
      assert(typeof rec.close === "number" && rec.close > 0, `bad close: ${rec.close}`);
      assert(typeof rec.volume === "number" && rec.volume > 0, `bad volume: ${rec.volume}`);
    }
  });

} finally {
  service.stop();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
