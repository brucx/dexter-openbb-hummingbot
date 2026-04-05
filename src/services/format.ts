/**
 * CLI formatting for TradeIntent proposals.
 *
 * Produces a readable, structured terminal representation of a proposal.
 */

import type { TradeIntent } from "../types/trade-intent";
import type { ResearchSnapshot } from "./research";
import type { ComparisonResult } from "./compare";

/** Status of an individual data source in the research snapshot. */
export type DataSourceStatus = "live" | "fallback" | "unavailable";

/** Availability of each research data source. */
export interface DataAvailability {
  quote: DataSourceStatus;
  priceHistory: DataSourceStatus;
  financials: DataSourceStatus;
  news: DataSourceStatus;
  errors?: string[];
}

/** Key research data points to surface in proposal display. */
export interface ResearchSummary {
  currentPrice?: number;
  dayChange?: number;
  dayChangePct?: number;
  volume?: number;
  marketCap?: number;
  peRatio?: number;
  priceRangeHigh?: number;
  priceRangeLow?: number;
  /** Financials highlights */
  revenue?: number;
  netIncome?: number;
  eps?: number;
  financialsPeriod?: string;
  /** Top news headlines */
  newsHeadlines?: string[];
  newsCount?: number;
  /** Data source availability */
  dataAvailability?: DataAvailability;
  /** Research snapshot timestamp */
  researchTimestamp?: string;
}

/** Extract a display-ready ResearchSummary from a full ResearchSnapshot. */
export function buildResearchSummary(snapshot: ResearchSnapshot): ResearchSummary {
  const summary: ResearchSummary = {
    researchTimestamp: snapshot.timestamp,
  };

  // Quote data
  if (snapshot.quote) {
    summary.currentPrice = snapshot.quote.price;
    summary.dayChange = snapshot.quote.change;
    summary.dayChangePct = snapshot.quote.changePct;
    summary.volume = snapshot.quote.volume;
    if (snapshot.quote.marketCap != null) summary.marketCap = snapshot.quote.marketCap;
    if (snapshot.quote.peRatio != null) summary.peRatio = snapshot.quote.peRatio;
  }

  // Price history → 30d range
  if (snapshot.priceHistory && snapshot.priceHistory.records.length > 0) {
    const prices = snapshot.priceHistory.records.map((r) => r.close);
    summary.priceRangeLow = Math.min(...prices);
    summary.priceRangeHigh = Math.max(...prices);
  }

  // Financials
  if (snapshot.financials) {
    const inc = snapshot.financials.incomeStatement;
    if (inc.revenue != null) summary.revenue = Number(inc.revenue);
    if (inc.net_income != null) summary.netIncome = Number(inc.net_income);
    if (inc.eps != null) summary.eps = Number(inc.eps);
    summary.financialsPeriod = snapshot.financials.period;
  }

  // News
  if (snapshot.news) {
    summary.newsCount = snapshot.news.articles.length;
    summary.newsHeadlines = snapshot.news.articles.slice(0, 3).map((a) => a.title);
  }

  // Data availability
  const sourceStatus = (data: { isFallback: boolean } | null): DataSourceStatus => {
    if (!data) return "unavailable";
    return data.isFallback ? "fallback" : "live";
  };

  // Financials may be "live" but have an empty income statement — treat as unavailable
  // so the UI status stays consistent with what the thesis/risks text infers
  let financialsStatus = sourceStatus(snapshot.financials);
  if (financialsStatus === "live" && snapshot.financials) {
    const inc = snapshot.financials.incomeStatement;
    if (!inc || Object.keys(inc).length === 0) {
      financialsStatus = "unavailable";
    }
  }

  summary.dataAvailability = {
    quote: sourceStatus(snapshot.quote),
    priceHistory: sourceStatus(snapshot.priceHistory),
    financials: financialsStatus,
    news: sourceStatus(snapshot.news),
    errors: snapshot.errors.length > 0 ? snapshot.errors : undefined,
  };

  return summary;
}

/** Analysis mode metadata for display. */
export interface AnalysisModeInfo {
  /** Whether LLM analysis was used (vs heuristic fallback) */
  usedLLM: boolean;
  /** Model name, if LLM was used */
  model?: string;
  /** Reason LLM was not used, if applicable */
  fallbackReason?: string;
  /** Token usage from LLM call, if available. Never set for heuristic path. */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Format a single TradeIntent for terminal display. */
export function formatProposal(intent: TradeIntent, opts?: { showId?: boolean; usedFallbackData?: boolean; researchSummary?: ResearchSummary; analysisMode?: AnalysisModeInfo }): string {
  const lines: string[] = [];
  const showId = opts?.showId ?? true;

  const dir = intent.direction.toUpperCase();
  const price =
    intent.order_type === "limit" && intent.limit_price != null
      ? `LIMIT @ $${intent.limit_price}`
      : "MARKET";

  lines.push(`┌─ Trade Proposal ──────────────────────────────`);
  lines.push(`│ ${dir} ${intent.asset}  ×${intent.quantity}  ${price}`);
  lines.push(`│`);

  if (intent.stop_loss != null || intent.take_profit != null) {
    const sl = intent.stop_loss != null ? `SL $${intent.stop_loss}` : "—";
    const tp = intent.take_profit != null ? `TP $${intent.take_profit}` : "—";
    lines.push(`│ Risk:       ${sl}  /  ${tp}`);
  }

  lines.push(`│ Horizon:    ${intent.time_horizon}    Position: ${intent.max_position_pct}% max`);
  lines.push(`│ Confidence: ${intent.confidence.toUpperCase()}`);
  lines.push(`│ Status:     ${intent.status}`);
  if (opts?.usedFallbackData != null) {
    const src = opts.usedFallbackData ? "FALLBACK (sample data)" : "LIVE";
    lines.push(`│ Data:       ${src}`);
  }
  if (opts?.analysisMode) {
    const am = opts.analysisMode;
    if (am.usedLLM) {
      lines.push(`│ Analysis:   LLM (${am.model ?? "unknown model"})`);
      if (am.tokenUsage) {
        const u = am.tokenUsage;
        lines.push(`│ Tokens:     ${u.totalTokens.toLocaleString()} (${u.promptTokens.toLocaleString()} prompt + ${u.completionTokens.toLocaleString()} completion)`);
      }
    } else {
      const reason = am.fallbackReason ? ` — ${am.fallbackReason}` : "";
      lines.push(`│ Analysis:   Heuristic${reason}`);
    }
  }
  lines.push(`│`);
  lines.push(`│ Thesis:`);
  // Wrap thesis to ~60 chars per line
  for (const chunk of wrapText(intent.thesis, 60)) {
    lines.push(`│   ${chunk}`);
  }

  if (intent.key_factors.length > 0) {
    lines.push(`│`);
    lines.push(`│ Supporting factors:`);
    for (const f of intent.key_factors) {
      lines.push(`│   + ${f}`);
    }
  }

  if (intent.key_risks.length > 0) {
    lines.push(`│`);
    lines.push(`│ Risks:`);
    for (const r of intent.key_risks) {
      lines.push(`│   - ${r}`);
    }
  }

  if (opts?.researchSummary) {
    const rs = opts.researchSummary;
    lines.push(`│`);
    const ts = rs.researchTimestamp ? ` (${rs.researchTimestamp.slice(0, 16).replace("T", " ")})` : "";
    lines.push(`│ Research snapshot:${ts}`);
    if (rs.currentPrice != null) {
      let chg = "";
      if (rs.dayChange != null && rs.dayChangePct != null) {
        if (Math.abs(rs.dayChangePct) < 0.01) {
          chg = "  (unchanged)";
        } else {
          chg = `  (${rs.dayChange >= 0 ? "+" : ""}${rs.dayChange.toFixed(2)} / ${rs.dayChangePct >= 0 ? "+" : ""}${rs.dayChangePct.toFixed(2)}%)`;
        }
      }
      lines.push(`│   Price: $${rs.currentPrice}${chg}`);
    }
    if (rs.volume != null) lines.push(`│   Volume: ${formatNumber(rs.volume)}`);
    if (rs.marketCap != null) lines.push(`│   Mkt Cap: $${formatNumber(rs.marketCap)}`);
    if (rs.peRatio != null) lines.push(`│   P/E: ${rs.peRatio.toFixed(2)}`);
    if (rs.priceRangeHigh != null && rs.priceRangeLow != null) {
      lines.push(`│   30d Range: $${rs.priceRangeLow} – $${rs.priceRangeHigh}`);
    }

    // Financials highlights
    if (rs.revenue != null || rs.netIncome != null || rs.eps != null) {
      const period = rs.financialsPeriod ? ` (${rs.financialsPeriod})` : "";
      lines.push(`│`);
      lines.push(`│ Financials${period}:`);
      if (rs.revenue != null) lines.push(`│   Revenue:    $${formatNumber(rs.revenue)}`);
      if (rs.netIncome != null) lines.push(`│   Net Income: $${formatNumber(rs.netIncome)}`);
      if (rs.eps != null) lines.push(`│   EPS:        $${rs.eps.toFixed(2)}`);
    }

    // News headlines
    if (rs.newsHeadlines && rs.newsHeadlines.length > 0) {
      lines.push(`│`);
      lines.push(`│ Recent news:`);
      for (const h of rs.newsHeadlines.slice(0, 3)) {
        lines.push(`│   • ${h}`);
      }
      if (rs.newsCount != null && rs.newsCount > rs.newsHeadlines.length) {
        lines.push(`│   (${rs.newsCount - rs.newsHeadlines.length} more)`);
      }
    } else if (rs.newsCount != null) {
      lines.push(`│   News articles: ${rs.newsCount}`);
    }

    // Data availability
    if (rs.dataAvailability) {
      const da = rs.dataAvailability;
      lines.push(`│`);
      lines.push(`│ Data sources:`);
      lines.push(`│   ${fmtSource("Quote", da.quote)}  ${fmtSource("History", da.priceHistory)}  ${fmtSource("Financials", da.financials)}  ${fmtSource("News", da.news)}`);
      if (da.errors && da.errors.length > 0) {
        for (const e of da.errors) {
          lines.push(`│   ! ${e}`);
        }
      }
    }
  }

  if (intent.approved_by || intent.approved_at) {
    lines.push(`│`);
    lines.push(`│ Approved by: ${intent.approved_by ?? "—"}  at ${intent.approved_at ?? "—"}`);
  }
  if (intent.rejection_reason) {
    lines.push(`│`);
    lines.push(`│ Rejection reason: ${intent.rejection_reason}`);
  }

  if (showId) {
    lines.push(`│`);
    lines.push(`│ ID: ${intent.id}`);
    lines.push(`│ Created: ${intent.timestamp}`);
  }

  lines.push(`└────────────────────────────────────────────────`);

  return lines.join("\n");
}

/** Optional price context for list display. Keyed by proposal ID. */
export type ListPriceContext = Map<string, { price: number; changePct?: number }>;

/** Format a list of proposals as a summary table. */
export function formatProposalList(intents: TradeIntent[], priceCtx?: ListPriceContext): string {
  if (intents.length === 0) return "No saved proposals.";

  const showPrice = priceCtx && priceCtx.size > 0;
  const lines: string[] = [];

  const hdr = showPrice
    ? `  ${"ID".padEnd(10)} ${"Asset".padEnd(10)} ${"Dir".padEnd(6)} ${"Price".padEnd(12)} ${"Conf".padEnd(7)} ${"Status".padEnd(10)} Created`
    : `  ${"ID".padEnd(10)} ${"Asset".padEnd(10)} ${"Dir".padEnd(6)} ${"Qty".padEnd(8)} ${"Conf".padEnd(7)} ${"Status".padEnd(10)} Created`;
  lines.push(hdr);

  const sep = showPrice
    ? `  ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(6)} ${"─".repeat(12)} ${"─".repeat(7)} ${"─".repeat(10)} ${"─".repeat(20)}`
    : `  ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(6)} ${"─".repeat(8)} ${"─".repeat(7)} ${"─".repeat(10)} ${"─".repeat(20)}`;
  lines.push(sep);

  for (const i of intents) {
    const created = i.timestamp.slice(0, 16).replace("T", " ");
    const shortId = i.id.slice(0, 8) + "…";
    if (showPrice) {
      const ctx = priceCtx!.get(i.id);
      const priceStr = ctx
        ? `$${ctx.price}${ctx.changePct != null ? ` ${ctx.changePct >= 0 ? "+" : ""}${ctx.changePct.toFixed(1)}%` : ""}`
        : "—";
      lines.push(
        `  ${shortId.padEnd(10)} ${i.asset.padEnd(10)} ${i.direction.padEnd(6)} ${priceStr.padEnd(12)} ${i.confidence.padEnd(7)} ${i.status.padEnd(10)} ${created}`,
      );
    } else {
      lines.push(
        `  ${shortId.padEnd(10)} ${i.asset.padEnd(10)} ${i.direction.padEnd(6)} ${String(i.quantity).padEnd(8)} ${i.confidence.padEnd(7)} ${i.status.padEnd(10)} ${created}`,
      );
    }
  }

  return lines.join("\n");
}

function fmtSource(label: string, status: DataSourceStatus): string {
  switch (status) {
    case "live": return `${label}: OK`;
    case "fallback": return `${label}: SAMPLE`;
    case "unavailable": return `${label}: --`;
  }
}

// ---------------------------------------------------------------------------
// Comparison formatting
// ---------------------------------------------------------------------------

/**
 * Format a ComparisonResult as a compact side-by-side terminal display.
 *
 * Shows: confidence, thesis excerpts, factor/risk counts, unique items,
 * and a summary verdict on whether the two paths diverged meaningfully.
 */
export function formatComparison(result: ComparisonResult): string {
  const { deltas } = result;
  const lines: string[] = [];

  const hIntent = result.heuristic.intent;
  const lIntent = result.llm.intent;

  lines.push(`┌─ Analysis Comparison: ${result.symbol} ─────────────────────`);
  lines.push(`│`);

  // LLM status
  if (result.llmActuallyUsed) {
    lines.push(`│ LLM path:     Active (${result.llm.llmModel ?? "unknown model"})`);
    if (deltas.llmTokens > 0) {
      lines.push(`│ Token cost:   ${deltas.llmTokens.toLocaleString()} tokens`);
    }
  } else {
    const reason = result.llm.fallbackDetail ?? result.llm.fallbackCategory ?? "unknown";
    lines.push(`│ LLM path:     Fell back to heuristic (${reason})`);
    lines.push(`│ NOTE: Both columns show heuristic output — LLM was not available.`);
  }
  lines.push(`│`);

  // Confidence
  const confMatch = deltas.confidenceDiffers ? "DIFFER" : "agree";
  lines.push(`│ ── Confidence ──────────────────── ${confMatch}`);
  lines.push(`│   Heuristic: ${deltas.heuristicConfidence.toUpperCase()}`);
  lines.push(`│   LLM:       ${deltas.llmConfidence.toUpperCase()}`);
  lines.push(`│`);

  // Direction
  lines.push(`│ ── Direction ───────────────────── ${deltas.directionAgrees ? "agree" : "DIFFER"}`);
  lines.push(`│   Heuristic: ${hIntent?.direction ?? "n/a"}`);
  lines.push(`│   LLM:       ${lIntent?.direction ?? "n/a"}`);
  lines.push(`│`);

  // Thesis comparison
  lines.push(`│ ── Thesis ──────────────────────────────────`);
  lines.push(`│   Heuristic (${deltas.heuristicThesisLength} chars):`);
  const hThesis = hIntent?.thesis ?? "(no proposal)";
  for (const chunk of wrapText(hThesis, 56)) {
    lines.push(`│     ${chunk}`);
  }
  lines.push(`│`);
  lines.push(`│   LLM (${deltas.llmThesisLength} chars):`);
  const lThesis = lIntent?.thesis ?? "(no proposal)";
  for (const chunk of wrapText(lThesis, 56)) {
    lines.push(`│     ${chunk}`);
  }
  lines.push(`│`);

  // Factor/risk counts
  lines.push(`│ ── Factors & Risks ────────────────────────`);
  lines.push(`│   Factors:  Heuristic ${deltas.heuristicFactorCount}  |  LLM ${deltas.llmFactorCount}`);
  lines.push(`│   Risks:    Heuristic ${deltas.heuristicRiskCount}  |  LLM ${deltas.llmRiskCount}`);

  // Unique factors
  if (deltas.heuristicOnlyFactors.length > 0 || deltas.llmOnlyFactors.length > 0) {
    lines.push(`│`);
    if (deltas.heuristicOnlyFactors.length > 0) {
      lines.push(`│   Heuristic-only factors (${deltas.heuristicOnlyFactors.length}):`);
      for (const f of deltas.heuristicOnlyFactors.slice(0, 5)) {
        lines.push(`│     + ${truncate(f, 54)}`);
      }
      if (deltas.heuristicOnlyFactors.length > 5) {
        lines.push(`│     (${deltas.heuristicOnlyFactors.length - 5} more)`);
      }
    }
    if (deltas.llmOnlyFactors.length > 0) {
      lines.push(`│   LLM-only factors (${deltas.llmOnlyFactors.length}):`);
      for (const f of deltas.llmOnlyFactors.slice(0, 5)) {
        lines.push(`│     + ${truncate(f, 54)}`);
      }
      if (deltas.llmOnlyFactors.length > 5) {
        lines.push(`│     (${deltas.llmOnlyFactors.length - 5} more)`);
      }
    }
  }

  // Unique risks
  if (deltas.heuristicOnlyRisks.length > 0 || deltas.llmOnlyRisks.length > 0) {
    lines.push(`│`);
    if (deltas.heuristicOnlyRisks.length > 0) {
      lines.push(`│   Heuristic-only risks (${deltas.heuristicOnlyRisks.length}):`);
      for (const r of deltas.heuristicOnlyRisks.slice(0, 5)) {
        lines.push(`│     - ${truncate(r, 54)}`);
      }
      if (deltas.heuristicOnlyRisks.length > 5) {
        lines.push(`│     (${deltas.heuristicOnlyRisks.length - 5} more)`);
      }
    }
    if (deltas.llmOnlyRisks.length > 0) {
      lines.push(`│   LLM-only risks (${deltas.llmOnlyRisks.length}):`);
      for (const r of deltas.llmOnlyRisks.slice(0, 5)) {
        lines.push(`│     - ${truncate(r, 54)}`);
      }
      if (deltas.llmOnlyRisks.length > 5) {
        lines.push(`│     (${deltas.llmOnlyRisks.length - 5} more)`);
      }
    }
  }

  // Summary verdict
  lines.push(`│`);
  lines.push(`│ ── Verdict ─────────────────────────────────`);
  if (!result.llmActuallyUsed) {
    lines.push(`│   LLM was not available — no meaningful comparison possible.`);
    lines.push(`│   Configure ANTHROPIC_API_KEY or OPENAI_API_KEY to enable.`);
  } else {
    const divergences: string[] = [];
    if (deltas.confidenceDiffers) divergences.push("confidence");
    if (!deltas.directionAgrees) divergences.push("direction");
    if (deltas.llmOnlyFactors.length > 0) divergences.push("unique LLM factors");
    if (deltas.llmOnlyRisks.length > 0) divergences.push("unique LLM risks");
    const thesisRatio = deltas.llmThesisLength / Math.max(deltas.heuristicThesisLength, 1);
    if (thesisRatio > 1.5 || thesisRatio < 0.5) divergences.push("thesis length");

    if (divergences.length === 0) {
      lines.push(`│   Minimal divergence — LLM output closely matches heuristic.`);
      lines.push(`│   LLM may not add significant value for this data context.`);
    } else {
      lines.push(`│   Divergence on: ${divergences.join(", ")}`);
      lines.push(`│   Review LLM-only items above to judge whether the`);
      lines.push(`│   additional analysis justifies the token cost.`);
    }
  }

  lines.push(`│`);
  lines.push(`│ Data quality: ${result.heuristic.dataQuality.liveCount}/4 live sources`);
  lines.push(`│ Compared at:  ${result.timestamp.slice(0, 19).replace("T", " ")}`);
  lines.push(`└────────────────────────────────────────────────`);

  return lines.join("\n");
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

function formatNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
