/**
 * ProposalBuilder — shapes research data into a draft TradeIntent.
 *
 * This is the early Phase 2 piece: given a ResearchSnapshot and some
 * analyst-like parameters, produce a structured TradeIntent in "proposed" status.
 *
 * The builder does NOT execute anything — it only creates proposals for human review.
 */

import { randomUUID } from "node:crypto";
import type { TradeIntent, Direction, OrderType, Confidence } from "../types/trade-intent";
import { validateTradeIntent } from "../types/trade-intent";
import type { ResearchSnapshot } from "./research";
import { detectLLMConfig } from "./llm-config";
import type { LLMConfig } from "./llm-config";
import { analyzeWithLLM } from "./llm-analysis";
import type { LLMAnalysisResult } from "./llm-analysis";

export interface ProposalInput {
  /** The research snapshot to base the proposal on */
  research: ResearchSnapshot;

  /** Trade direction */
  direction: Direction;

  /** Order type */
  orderType: OrderType;

  /** Quantity in base asset units */
  quantity: number;

  /** Limit price (required if orderType is "limit") */
  limitPrice?: number;

  /** Stop loss price */
  stopLoss?: number;

  /** Take profit price */
  takeProfit?: number;

  /** Expected holding period, e.g. "1d", "1w" */
  timeHorizon: string;

  /** Max position as % of portfolio */
  maxPositionPct: number;

  /** One-paragraph thesis */
  thesis: string;

  /** Agent's confidence */
  confidence: Confidence;

  /** Supporting factors */
  keyFactors: string[];

  /** Key risks */
  keyRisks: string[];
}

export interface ProposalResult {
  /** The draft TradeIntent, or null if validation failed */
  intent: TradeIntent | null;

  /** Validation errors, if any */
  errors: string[];

  /** Whether the underlying research used fallback data */
  usedFallbackData: boolean;

  /** Data quality assessment for this proposal */
  dataQuality: DataQualityAssessment;

  /** Whether LLM analysis was used (vs heuristic fallback) */
  usedLLMAnalysis?: boolean;

  /** Model that produced the analysis, if LLM was used */
  llmModel?: string;
}

// ---------------------------------------------------------------------------
// Data quality assessment
// ---------------------------------------------------------------------------

export interface DataQualityAssessment {
  /** Maximum confidence justified by available data */
  maxConfidence: Confidence;

  /** Whether the requested confidence was capped */
  confidenceWasCapped: boolean;

  /** Per-source status */
  sources: {
    quote: SourceStatus;
    priceHistory: SourceStatus;
    financials: SourceStatus;
    news: SourceStatus;
  };

  /** Number of sources that are live (not fallback, not missing) */
  liveCount: number;

  /** Number of sources that are fallback/sample */
  fallbackCount: number;

  /** Number of sources that are completely missing */
  missingCount: number;

  /** Auto-generated risk warnings from data gaps */
  dataRisks: string[];
}

export type SourceStatus = "live" | "fallback" | "missing";

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_FROM_RANK: Confidence[] = ["low", "medium", "high"];

/**
 * Assess the quality of a ResearchSnapshot and determine how it should
 * constrain the proposal.
 *
 * Rules (simple and explicit):
 * - Quote missing → max confidence "low" (we don't even know the price)
 * - Any core source missing (quote/history/financials) → max "medium"
 * - All core sources present but any are fallback → max "medium"
 * - All core sources live → max "high" (news is nice-to-have, not gating)
 * - Each gap produces a specific risk warning
 */
export function assessDataQuality(research: ResearchSnapshot): DataQualityAssessment {
  const sourceStatus = (
    data: { isFallback: boolean } | null | undefined,
  ): SourceStatus => {
    if (!data) return "missing";
    return data.isFallback ? "fallback" : "live";
  };

  const sources = {
    quote: sourceStatus(research.quote),
    priceHistory: sourceStatus(research.priceHistory),
    financials: sourceStatus(research.financials),
    news: sourceStatus(research.news),
  };

  // Financials may be technically "live" but have no usable income statement data —
  // treat as missing so confidence capping and risk warnings stay consistent with
  // what extractFinancialSignals will actually produce (null).
  if (sources.financials === "live" && research.financials) {
    const inc = research.financials.incomeStatement;
    if (!inc || Object.keys(inc).length === 0) {
      sources.financials = "missing";
    }
  }

  const allStatuses = Object.values(sources);
  const liveCount = allStatuses.filter((s) => s === "live").length;
  const fallbackCount = allStatuses.filter((s) => s === "fallback").length;
  const missingCount = allStatuses.filter((s) => s === "missing").length;

  // Core sources are quote, priceHistory, financials — news is supplementary
  const coreSources = [sources.quote, sources.priceHistory, sources.financials];
  const coreMissing = coreSources.filter((s) => s === "missing").length;
  const coreFallback = coreSources.filter((s) => s === "fallback").length;

  // Determine max confidence
  let maxConfidence: Confidence;
  if (sources.quote === "missing") {
    // No price data at all — can't justify any real confidence
    maxConfidence = "low";
  } else if (coreMissing > 0) {
    // Missing core data — cap at medium
    maxConfidence = "medium";
  } else if (coreFallback > 0) {
    // Have all core sources but some are sample data — cap at medium
    maxConfidence = "medium";
  } else {
    // All core sources are live
    maxConfidence = "high";
  }

  // Build specific risk warnings for data gaps
  const dataRisks: string[] = [];

  if (sources.quote === "missing") {
    dataRisks.push("No price data available — proposal is based on assumed/default pricing");
  } else if (sources.quote === "fallback") {
    dataRisks.push("Price data is sample/fallback — does not reflect actual market conditions");
  }

  if (sources.priceHistory === "missing") {
    dataRisks.push("No price history — trend and volatility analysis not possible");
  } else if (sources.priceHistory === "fallback") {
    dataRisks.push("Price history is sample data — trend signals are not meaningful");
  }

  if (sources.financials === "missing") {
    dataRisks.push("No financial data — fundamental analysis not available");
  } else if (sources.financials === "fallback") {
    dataRisks.push("Financial data is sample — valuation metrics are not meaningful");
  }

  if (sources.news === "missing") {
    dataRisks.push("No news data — sentiment and event risk not assessed");
  } else if (sources.news === "fallback") {
    dataRisks.push("News data is sample — sentiment signals are not meaningful");
  }

  // Add research errors as risks
  for (const err of research.errors) {
    dataRisks.push(`Research error: ${err}`);
  }

  return {
    maxConfidence,
    confidenceWasCapped: false, // set by buildProposal after comparing with requested
    sources,
    liveCount,
    fallbackCount,
    missingCount,
    dataRisks,
  };
}

/**
 * Cap a requested confidence to the maximum justified by data quality.
 * Returns the effective confidence (may be lower than requested).
 */
function capConfidence(requested: Confidence, max: Confidence): Confidence {
  const reqRank = CONFIDENCE_RANK[requested];
  const maxRank = CONFIDENCE_RANK[max];
  return CONFIDENCE_FROM_RANK[Math.min(reqRank, maxRank)]!;
}

/**
 * Build a draft TradeIntent from research data and analyst parameters.
 *
 * Applies graceful degradation:
 * - Confidence is capped based on data quality
 * - Data-gap risks are appended to key_risks
 * - Thesis gets a caveat prefix when data is incomplete
 *
 * Returns errors if the proposal doesn't pass validation.
 * The intent is always in "proposed" status — never approved or executing.
 */
export function buildProposal(input: ProposalInput): ProposalResult {
  const usedFallbackData = Boolean(
    input.research.quote?.isFallback ||
    input.research.priceHistory?.isFallback ||
    input.research.financials?.isFallback ||
    input.research.news?.isFallback,
  );

  // Assess data quality and apply degradation
  const dataQuality = assessDataQuality(input.research);
  const effectiveConfidence = capConfidence(input.confidence, dataQuality.maxConfidence);
  dataQuality.confidenceWasCapped = effectiveConfidence !== input.confidence;

  // Build thesis — add caveat when data is incomplete
  let thesis = input.thesis;
  if (dataQuality.missingCount >= 2) {
    thesis = `[LIMITED DATA — ${dataQuality.missingCount} of 4 sources unavailable] ${thesis}`;
  } else if (usedFallbackData && dataQuality.fallbackCount >= 2) {
    thesis = `[WEAK EVIDENCE — based partly on sample data] ${thesis}`;
  }

  // Merge data-gap risks into key_risks (avoid duplicates)
  const existingRisks = new Set(input.keyRisks);
  const mergedRisks = [...input.keyRisks];
  for (const risk of dataQuality.dataRisks) {
    if (!existingRisks.has(risk)) {
      mergedRisks.push(risk);
    }
  }

  const draft: TradeIntent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    asset: input.research.symbol,
    direction: input.direction,
    order_type: input.orderType,
    quantity: input.quantity,
    time_horizon: input.timeHorizon,
    max_position_pct: input.maxPositionPct,
    thesis,
    confidence: effectiveConfidence,
    key_factors: input.keyFactors,
    key_risks: mergedRisks,
    research_ref: `research-snapshot:${input.research.symbol}:${input.research.timestamp}`,
    status: "proposed",
  };

  // Optional fields
  if (input.limitPrice != null) draft.limit_price = input.limitPrice;
  if (input.stopLoss != null) draft.stop_loss = input.stopLoss;
  if (input.takeProfit != null) draft.take_profit = input.takeProfit;

  const errors = validateTradeIntent(draft);

  return {
    intent: errors.length === 0 ? draft : null,
    errors,
    usedFallbackData,
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// Signal extraction — mine concrete observations from research data
// ---------------------------------------------------------------------------

/** Extracted price signals from quote + price history. */
export interface PriceSignals {
  currentPrice: number;
  dayChange: number;
  dayChangePct: number;
  volume: number;
  marketCap?: number;
  peRatio?: number;
  /** 30-day high/low from price history, if available */
  rangeHigh?: number;
  rangeLow?: number;
  /** Where current price sits in the 30-day range (0 = at low, 1 = at high) */
  rangePosition?: number;
  /** Simple trend: "up", "down", or "flat" based on first vs last close */
  recentTrend?: "up" | "down" | "flat";
  /** Percentage change over the history period */
  periodChangePct?: number;
}

/** Extracted financial signals. */
export interface FinancialSignals {
  revenue?: number;
  netIncome?: number;
  eps?: number;
  /** Whether the company appears profitable based on net income */
  profitable?: boolean;
}

/** Extracted news signals. */
export interface NewsSignals {
  articleCount: number;
  headlines: string[];
  hasRecentNews: boolean;
}

/** All signals extracted from a research snapshot. */
export interface ResearchSignals {
  price: PriceSignals | null;
  financials: FinancialSignals | null;
  news: NewsSignals | null;
}

/**
 * Extract concrete, observable signals from research data.
 * No interpretation — just structured observations a human could verify.
 */
export function extractSignals(research: ResearchSnapshot): ResearchSignals {
  return {
    price: extractPriceSignals(research),
    financials: extractFinancialSignals(research),
    news: extractNewsSignals(research),
  };
}

function extractPriceSignals(research: ResearchSnapshot): PriceSignals | null {
  if (!research.quote || research.quote.isFallback) return null;
  const q = research.quote;
  const signals: PriceSignals = {
    currentPrice: q.price,
    dayChange: q.change,
    dayChangePct: q.changePct,
    volume: q.volume,
    marketCap: q.marketCap,
    peRatio: q.peRatio,
  };

  // Mine price history for range and trend
  const history = research.priceHistory;
  if (history && !history.isFallback && history.records.length >= 2) {
    const closes = history.records.map((r) => r.close);
    const highs = history.records.map((r) => r.high);
    const lows = history.records.map((r) => r.low);

    signals.rangeHigh = Math.max(...highs);
    signals.rangeLow = Math.min(...lows);

    if (signals.rangeHigh > signals.rangeLow) {
      signals.rangePosition =
        (q.price - signals.rangeLow) / (signals.rangeHigh - signals.rangeLow);
    }

    const firstClose = closes[0]!;
    const lastClose = closes[closes.length - 1]!;
    const changePct = ((lastClose - firstClose) / firstClose) * 100;
    signals.periodChangePct = Math.round(changePct * 100) / 100;

    if (changePct > 1) signals.recentTrend = "up";
    else if (changePct < -1) signals.recentTrend = "down";
    else signals.recentTrend = "flat";
  }

  return signals;
}

function extractFinancialSignals(research: ResearchSnapshot): FinancialSignals | null {
  if (!research.financials || research.financials.isFallback) return null;
  const inc = research.financials.incomeStatement;
  if (!inc || Object.keys(inc).length === 0) return null;

  const revenue = toNumber(inc.total_revenue ?? inc.revenue);
  const netIncome = toNumber(inc.net_income);
  const eps = toNumber(inc.basic_eps ?? inc.eps ?? inc.earnings_per_share);

  // Only return if we found at least one meaningful field
  if (revenue == null && netIncome == null && eps == null) return null;

  return {
    revenue: revenue ?? undefined,
    netIncome: netIncome ?? undefined,
    eps: eps ?? undefined,
    profitable: netIncome != null ? netIncome > 0 : undefined,
  };
}

function extractNewsSignals(research: ResearchSnapshot): NewsSignals | null {
  if (!research.news || research.news.isFallback) return null;
  const articles = research.news.articles;
  return {
    articleCount: articles.length,
    headlines: articles.slice(0, 3).map((a) => a.title).filter(Boolean),
    hasRecentNews: articles.length > 0,
  };
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Grounded content generation — build thesis/factors/risks from signals
// ---------------------------------------------------------------------------

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function buildGroundedThesis(symbol: string, signals: ResearchSignals): string {
  const parts: string[] = [];

  if (signals.price) {
    const p = signals.price;
    parts.push(`${symbol} is trading at $${p.currentPrice.toFixed(2)}`);

    if (p.recentTrend && p.periodChangePct != null) {
      const trendWord = p.recentTrend === "up" ? "upward" : p.recentTrend === "down" ? "downward" : "sideways";
      parts.push(`with a ${trendWord} trend over the observed period (${p.periodChangePct > 0 ? "+" : ""}${p.periodChangePct}%)`);
    }

    if (p.rangeHigh != null && p.rangeLow != null) {
      parts.push(`within a $${p.rangeLow.toFixed(2)}–$${p.rangeHigh.toFixed(2)} range`);
    }
  } else {
    parts.push(`${symbol} — limited price data available`);
  }

  if (signals.financials) {
    const f = signals.financials;
    if (f.revenue != null) {
      parts.push(`Revenue: ${formatLargeNumber(f.revenue)}`);
    }
    if (f.profitable != null) {
      parts.push(f.profitable ? "company appears profitable" : "company is not currently profitable");
    }
  }

  if (!signals.price && !signals.financials) {
    return `[AUTO-DRAFT] Insufficient live data for ${symbol}. This proposal is a placeholder pending better data.`;
  }

  return `[AUTO-DRAFT] ${parts.join(". ")}. This is a heuristic draft based on observed data — not a recommendation.`;
}

function buildGroundedFactors(signals: ResearchSignals): string[] {
  const factors: string[] = [];

  if (signals.price) {
    const p = signals.price;
    const dayChgLabel = Math.abs(p.dayChangePct) < 0.01
      ? "unchanged today"
      : `${p.dayChangePct >= 0 ? "+" : ""}${p.dayChangePct.toFixed(2)}% today`;
    factors.push(`Current price: $${p.currentPrice.toFixed(2)} (${dayChgLabel})`);

    if (p.volume > 0) {
      factors.push(`Volume: ${p.volume.toLocaleString()}`);
    }

    if (p.marketCap != null) {
      factors.push(`Market cap: ${formatLargeNumber(p.marketCap)}`);
    }

    if (p.peRatio != null) {
      factors.push(`P/E ratio: ${p.peRatio.toFixed(1)}`);
    }

    if (p.rangeHigh != null && p.rangeLow != null && p.rangePosition != null) {
      const posLabel =
        p.rangePosition > 0.8 ? "near the high" :
        p.rangePosition < 0.2 ? "near the low" :
        "mid-range";
      factors.push(`30-day range: $${p.rangeLow.toFixed(2)}–$${p.rangeHigh.toFixed(2)} (currently ${posLabel})`);
    }

    if (p.recentTrend) {
      const trendDesc =
        p.recentTrend === "up" ? "Upward" :
        p.recentTrend === "down" ? "Downward" : "Sideways";
      factors.push(`Recent trend: ${trendDesc}${p.periodChangePct != null ? ` (${p.periodChangePct > 0 ? "+" : ""}${p.periodChangePct}% over period)` : ""}`);
    }
  }

  if (signals.financials) {
    const f = signals.financials;
    if (f.revenue != null) factors.push(`Revenue: ${formatLargeNumber(f.revenue)}`);
    if (f.netIncome != null) factors.push(`Net income: ${formatLargeNumber(f.netIncome)}`);
    if (f.eps != null) factors.push(`EPS: $${f.eps.toFixed(2)}`);
  }

  if (signals.news) {
    if (signals.news.articleCount > 0) {
      factors.push(`News coverage: ${signals.news.articleCount} recent article(s)`);
      if (signals.news.headlines.length > 0) {
        factors.push(`Recent headline (may reflect broader market/sector): "${signals.news.headlines[0]}"`);
      }
    } else {
      factors.push("No recent news coverage found");
    }
  }

  // Always include honest data-availability note
  const available: string[] = [];
  if (signals.price) available.push("price");
  if (signals.price?.rangeHigh != null) available.push("history");
  if (signals.financials) available.push("financials");
  if (signals.news) available.push("news");
  factors.push(`Live data sources used: ${available.length > 0 ? available.join(", ") : "none"}`);

  return factors;
}

function buildGroundedRisks(signals: ResearchSignals): string[] {
  const risks: string[] = [
    "Auto-generated draft — no deep analysis performed, human review required",
  ];

  if (signals.price) {
    const p = signals.price;
    if (p.recentTrend === "down") {
      risks.push(`Price is in a downward trend (${p.periodChangePct}% over observed period)`);
    }
    if (p.rangePosition != null && p.rangePosition > 0.9) {
      risks.push("Price is near 30-day high — limited upside if range-bound");
    }
    if (p.peRatio != null && p.peRatio > 40) {
      risks.push(`Elevated P/E ratio (${p.peRatio.toFixed(1)}) — may reflect high expectations`);
    }
    if (p.peRatio != null && p.peRatio < 0) {
      risks.push("Negative P/E ratio — company may not be profitable");
    }
  }

  if (signals.financials?.profitable === false) {
    risks.push("Company appears unprofitable based on most recent financials");
  }

  if (!signals.price) {
    risks.push("No live price data — all price levels in this proposal are placeholders");
  }
  if (!signals.financials) {
    risks.push("No live financial data — fundamental picture unknown");
  }
  if (!signals.news) {
    risks.push("No live news data — event risk and sentiment not assessed");
  }

  return risks;
}

// ---------------------------------------------------------------------------
// autoDraftProposal — now grounded in research signals
// ---------------------------------------------------------------------------

/**
 * Auto-generate a proposal from a research snapshot, grounded in observed data.
 *
 * Extracts concrete signals from quote, price history, financials, and news,
 * then builds thesis/factors/risks that reference actual data points.
 *
 * Still clearly marked as auto-draft — this is heuristic, not real analysis.
 * When data is thin, the output is cautious and says so explicitly.
 */
export function autoDraftProposal(
  research: ResearchSnapshot,
  overrides: Partial<ProposalInput> = {},
): ProposalResult {
  const signals = extractSignals(research);
  const price = signals.price?.currentPrice ?? research.quote?.price ?? 100;

  const defaults: ProposalInput = {
    research,
    direction: "long",
    orderType: "limit",
    quantity: 1,
    limitPrice: Math.round(price * 100) / 100,
    stopLoss: Math.round(price * 0.95 * 100) / 100,  // 5% stop
    takeProfit: Math.round(price * 1.10 * 100) / 100, // 10% target
    timeHorizon: "1w",
    maxPositionPct: 2,
    thesis: buildGroundedThesis(research.symbol, signals),
    confidence: "low",
    keyFactors: buildGroundedFactors(signals),
    keyRisks: buildGroundedRisks(signals),
    ...overrides,
  };

  return buildProposal(defaults);
}

// ---------------------------------------------------------------------------
// LLM-assisted proposal generation (async, with heuristic fallback)
// ---------------------------------------------------------------------------

export interface LLMProposalOptions {
  /** Override LLM config (default: auto-detect from env) */
  llmConfig?: LLMConfig;

  /** Env vars to check for LLM config (default: process.env) */
  env?: Record<string, string | undefined>;

  /** Timeout for LLM API call in ms (default: 30000) */
  timeoutMs?: number;

  /** Override fields on the proposal */
  overrides?: Partial<ProposalInput>;
}

/**
 * Generate a proposal using LLM analysis when available, falling back to
 * heuristic generation otherwise.
 *
 * Flow:
 * 1. Extract signals from research (same as heuristic path)
 * 2. Check if an LLM provider is configured
 * 3. If yes: call LLM for thesis/factors/risks synthesis, merge with data quality
 * 4. If no (or LLM fails): fall back to autoDraftProposal (heuristic)
 *
 * The heuristic path is always available and never removed.
 */
export async function autoDraftProposalWithLLM(
  research: ResearchSnapshot,
  options: LLMProposalOptions = {},
): Promise<ProposalResult> {
  const { timeoutMs = 30_000, overrides = {} } = options;

  // Always extract signals — needed for both paths
  const signals = extractSignals(research);

  // Resolve LLM config
  const llmAvailability = options.llmConfig
    ? { available: true, config: options.llmConfig, reason: "explicit config", checked: [] }
    : detectLLMConfig(options.env);

  if (!llmAvailability.available || !llmAvailability.config) {
    // No LLM available — heuristic fallback
    const result = autoDraftProposal(research, overrides);
    result.usedLLMAnalysis = false;
    return result;
  }

  // Try LLM analysis
  let llmResult: LLMAnalysisResult | null = null;
  try {
    llmResult = await analyzeWithLLM(
      llmAvailability.config,
      research.symbol,
      signals,
      { timeoutMs },
    );
  } catch {
    // Swallow — fall through to heuristic
  }

  if (!llmResult) {
    // LLM failed — heuristic fallback
    const result = autoDraftProposal(research, overrides);
    result.usedLLMAnalysis = false;
    return result;
  }

  // Build proposal using LLM output, still applying data quality constraints
  const price = signals.price?.currentPrice ?? research.quote?.price ?? 100;

  const proposalInput: ProposalInput = {
    research,
    direction: "long",
    orderType: "limit",
    quantity: 1,
    limitPrice: Math.round(price * 100) / 100,
    stopLoss: Math.round(price * 0.95 * 100) / 100,
    takeProfit: Math.round(price * 1.10 * 100) / 100,
    timeHorizon: "1w",
    maxPositionPct: 2,
    // LLM-generated content (marked as such, with model attribution)
    thesis: `[LLM-DRAFT via ${llmResult.model}] ${llmResult.thesis}`,
    confidence: llmResult.confidence,
    keyFactors: llmResult.keyFactors,
    keyRisks: [
      ...llmResult.keyRisks,
      `Analysis generated by ${llmResult.model} — verify all claims against source data`,
    ],
    ...overrides,
  };

  const result = buildProposal(proposalInput);
  result.usedLLMAnalysis = true;
  result.llmModel = llmResult.model;
  return result;
}
