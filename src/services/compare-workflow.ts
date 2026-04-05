/**
 * Compare workflow — thin orchestration for the research → compare pipeline.
 *
 * Like analyzeSymbol but runs both heuristic and LLM paths on the same
 * research snapshot and returns a ComparisonResult instead of a single proposal.
 */

import { ResearchService } from "./research";
import type { ResearchSnapshot } from "./research";
import { compareAnalysis } from "./compare";
import type { ComparisonResult } from "./compare";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompareWorkflowOptions {
  /** Stock symbol to compare (e.g. "AAPL") */
  symbol: string;

  /** Python binary for the OpenBB bridge */
  pythonBin?: string;

  /** Bridge environment overrides */
  env?: Record<string, string>;

  /** Pre-configured ResearchService */
  service?: ResearchService;

  /** Timeout for LLM API call in ms */
  timeoutMs?: number;
}

export interface CompareWorkflowResult {
  symbol: string;
  comparison: ComparisonResult;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Wait for the bridge to either stabilize or crash (same logic as workflow.ts).
 */
async function waitForBridge(
  service: ResearchService,
  { intervalMs = 50, maxWaitMs = 2000 } = {},
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  await new Promise((r) => setTimeout(r, intervalMs));

  while (Date.now() < deadline) {
    if (!service.ready) {
      const diag = service.diagnostics;
      throw new Error(
        `Bridge process exited during startup.${diag.length > 0 ? "\n  " + diag.join("\n  ") : ""}`,
      );
    }
    if (Date.now() - (deadline - maxWaitMs) >= 100) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Run the compare workflow:
 * 1. Start research service
 * 2. Gather research snapshot
 * 3. Run both heuristic and LLM analysis on the same data
 * 4. Return structured comparison (no persistence — this is read-only)
 */
export async function compareSymbol(
  options: CompareWorkflowOptions,
): Promise<CompareWorkflowResult> {
  const { symbol, pythonBin, env } = options;
  const service = options.service ?? new ResearchService({ pythonBin, env });

  try {
    service.start();
    await waitForBridge(service);

    const research = await service.research(symbol);

    const comparison = await compareAnalysis(research, {
      timeoutMs: options.timeoutMs,
      env: options.env,
    });

    return { symbol, comparison };
  } finally {
    service.stop();
  }
}
