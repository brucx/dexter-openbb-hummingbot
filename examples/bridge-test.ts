#!/usr/bin/env npx tsx
/**
 * bridge-test.ts — Low-level test of the OpenBB bridge protocol.
 *
 * Usage:
 *   npx tsx examples/bridge-test.ts
 *
 * Environment:
 *   OPENBB_BRIDGE_MODE=auto|live|fallback  (default: auto)
 *
 * Sends individual JSON Lines requests to the Python bridge and prints responses.
 * Useful for verifying the bridge works before running the full research pipeline.
 */

import { BridgeClient } from "../src/bridge/bridge-client";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bridgePath = join(__dirname, "..", "src", "bridge", "openbb_bridge.py");

async function main() {
  const bridgeMode = process.env.OPENBB_BRIDGE_MODE ?? "auto";
  console.log(`=== OpenBB Bridge Protocol Test (${bridgeMode} mode) ===\n`);

  const env: Record<string, string> = {};
  if (bridgeMode !== "auto") {
    env.OPENBB_BRIDGE_MODE = bridgeMode;
  }

  const client = new BridgeClient({
    scriptPath: bridgePath,
    env,
  });

  client.start();
  await new Promise((r) => setTimeout(r, 500)); // let bridge init

  const tests: Array<{ method: string; params: Record<string, unknown> }> = [
    { method: "quote", params: { symbol: "AAPL" } },
    { method: "price_history", params: { symbol: "TSLA", days: 5 } },
    { method: "financials", params: { symbol: "MSFT" } },
    { method: "news", params: { symbol: "GOOGL" } },
    { method: "technicals", params: { symbol: "AAPL" } }, // stub
    { method: "nonexistent", params: {} }, // error case
  ];

  for (const test of tests) {
    console.log(`--- ${test.method}(${JSON.stringify(test.params)}) ---`);
    try {
      const resp = await client.request(test.method as any, test.params);
      if (resp.error) {
        console.log(`  Error: ${resp.error}`);
      } else {
        // Print a compact summary
        const data = resp.data as Record<string, unknown>;
        const keys = Object.keys(data);
        console.log(`  OK — keys: [${keys.join(", ")}]`);
        if (data._fallback) console.log(`  (fallback data)`);
        if (data._stub) console.log(`  (stub — not yet implemented)`);
      }
    } catch (e) {
      console.log(`  Exception: ${(e as Error).message}`);
    }
    console.log();
  }

  console.log("Bridge diagnostics (stderr):");
  for (const line of client.diagnostics) {
    console.log(`  ${line}`);
  }

  client.stop();
  console.log("\n=== Done ===");
}

main();
