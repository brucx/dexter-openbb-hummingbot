/**
 * LLM-assisted analysis — uses a language model to synthesize research signals
 * into higher-quality thesis, factors, and risks for trade proposals.
 *
 * Design principles:
 * - Grounded: the model only sees extracted signals, not raw data. It summarizes
 *   what was observed, never invents unseen facts.
 * - Honest: prompts instruct the model to flag uncertainty and data gaps.
 * - Fallback-safe: any LLM failure returns null, and the caller falls back to
 *   heuristic generation. The heuristic path is never removed.
 * - No SDK deps: uses native fetch() to call OpenAI-compatible or Anthropic APIs.
 */

import type { LLMConfig } from "./llm-config";
import type { ResearchSignals } from "./proposal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured output from LLM analysis. */
export interface LLMAnalysisResult {
  /** Synthesized investment thesis (1-2 paragraphs) */
  thesis: string;

  /** Key factors supporting or challenging the thesis */
  keyFactors: string[];

  /** Key risks identified from the data */
  keyRisks: string[];

  /** Model's self-assessed confidence in this analysis */
  confidence: "low" | "medium" | "high";

  /** Which model produced this analysis */
  model: string;

  /** Token usage info, if available */
  usage?: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(symbol: string, signals: ResearchSignals): string {
  const sections: string[] = [];

  sections.push(`Analyze the following market data for ${symbol} and produce a structured investment analysis.`);
  sections.push("");
  sections.push("IMPORTANT RULES:");
  sections.push("- Only reference data points provided below. Do NOT invent prices, dates, or facts.");
  sections.push("- If data is thin or missing for a category, say so explicitly.");
  sections.push("- Express uncertainty honestly — use phrases like 'based on available data' or 'limited visibility'.");
  sections.push("- This is a draft analysis for human review, not a recommendation.");
  sections.push("");

  // Price signals
  sections.push("## Price Data");
  if (signals.price) {
    const p = signals.price;
    sections.push(`- Current price: $${p.currentPrice.toFixed(2)}`);
    if (Math.abs(p.dayChangePct) < 0.01) {
      sections.push("- Day change: unchanged (0.00%)");
    } else {
      sections.push(`- Day change: ${p.dayChangePct >= 0 ? "+" : ""}${p.dayChangePct.toFixed(2)}%`);
    }
    if (p.volume > 0) sections.push(`- Volume: ${p.volume.toLocaleString()}`);
    if (p.marketCap != null) sections.push(`- Market cap: $${(p.marketCap / 1e9).toFixed(1)}B`);
    if (p.peRatio != null) sections.push(`- P/E ratio: ${p.peRatio.toFixed(1)}`);
    if (p.rangeHigh != null && p.rangeLow != null) {
      sections.push(`- 30-day range: $${p.rangeLow.toFixed(2)} – $${p.rangeHigh.toFixed(2)}`);
    }
    if (p.rangePosition != null) {
      sections.push(`- Position in range: ${(p.rangePosition * 100).toFixed(0)}% (0%=low, 100%=high)`);
    }
    if (p.recentTrend) {
      sections.push(`- Recent trend: ${p.recentTrend} (${p.periodChangePct != null ? `${p.periodChangePct > 0 ? "+" : ""}${p.periodChangePct}%` : "n/a"})`);
    }
  } else {
    sections.push("No live price data available.");
  }
  sections.push("");

  // Financial signals
  sections.push("## Financial Data");
  if (signals.financials) {
    const f = signals.financials;
    if (f.revenue != null) sections.push(`- Revenue: $${(f.revenue / 1e9).toFixed(2)}B`);
    if (f.netIncome != null) sections.push(`- Net income: $${(f.netIncome / 1e9).toFixed(2)}B`);
    if (f.eps != null) sections.push(`- EPS: $${f.eps.toFixed(2)}`);
    if (f.profitable != null) sections.push(`- Profitable: ${f.profitable ? "yes" : "no"}`);
  } else {
    sections.push("No live financial data available.");
  }
  sections.push("");

  // News signals
  sections.push("## News");
  if (signals.news) {
    sections.push(`- ${signals.news.articleCount} recent article(s)`);
    sections.push("- Note: headlines may include general sector or market news, not necessarily specific to this company. Do not overstate their relevance.");
    if (signals.news.headlines.length > 0) {
      sections.push("- Headlines:");
      for (const h of signals.news.headlines) {
        sections.push(`  - "${h}"`);
      }
    }
  } else {
    sections.push("No live news data available.");
  }
  sections.push("");

  sections.push("## Required Output Format");
  sections.push("Respond with ONLY a JSON object (no markdown fencing, no extra text) with this exact structure:");
  sections.push(JSON.stringify({
    thesis: "1-2 paragraph investment thesis grounded in the data above",
    keyFactors: ["factor 1", "factor 2", "..."],
    keyRisks: ["risk 1", "risk 2", "..."],
    confidence: "low | medium | high",
  }, null, 2));
  sections.push("");
  sections.push("Set confidence based on data completeness: 'low' if major data is missing, 'medium' if some gaps, 'high' only if all categories have live data and signals are clear.");

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// API callers (no SDK — raw fetch)
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM_MESSAGE = `You are a financial data analyst assistant. You produce structured investment analyses based strictly on provided market data. You never invent data points, and you clearly state when information is limited or missing. Your analyses are drafts for human review — never recommendations.`;

async function callOpenAICompatible(
  config: LLMConfig,
  prompt: string,
  timeoutMs = 30_000,
): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_MESSAGE },
    { role: "user", content: prompt },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  config: LLMConfig,
  prompt: string,
  timeoutMs = 30_000,
): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        system: SYSTEM_MESSAGE,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    return {
      content: textBlock?.text ?? "",
      usage: data.usage
        ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens }
        : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseAnalysisResponse(raw: string, model: string, usage?: { prompt_tokens: number; completion_tokens: number }): LLMAnalysisResult | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (
      typeof parsed.thesis !== "string" ||
      !Array.isArray(parsed.keyFactors) ||
      !Array.isArray(parsed.keyRisks)
    ) {
      return null;
    }

    const confidence = ["low", "medium", "high"].includes(parsed.confidence)
      ? (parsed.confidence as "low" | "medium" | "high")
      : "low";

    return {
      thesis: parsed.thesis,
      keyFactors: parsed.keyFactors.filter((f: unknown) => typeof f === "string"),
      keyRisks: parsed.keyRisks.filter((r: unknown) => typeof r === "string"),
      confidence,
      model,
      usage: usage
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
        : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM output guardrails — lightweight, deterministic validation
// ---------------------------------------------------------------------------

/** Minimum thesis length to be considered substantive (in characters). */
const MIN_THESIS_LENGTH = 20;

/** Minimum number of key factors required. */
const MIN_KEY_FACTORS = 1;

/** Minimum number of key risks required. */
const MIN_KEY_RISKS = 1;

/** Maximum thesis length before we suspect garbage output (in characters). */
const MAX_THESIS_LENGTH = 5000;

/** Validation result with reason for rejection. */
export interface GuardrailResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Validate LLM-generated analysis output against lightweight guardrails.
 *
 * These checks are simple and deterministic — no AI moderation, no fancy stack.
 * They catch obviously broken or degenerate LLM output so the system can fall
 * back to heuristic analysis instead of surfacing garbage to a human reviewer.
 *
 * Checks:
 * - Thesis is non-empty and at least MIN_THESIS_LENGTH chars
 * - Thesis is not unreasonably long (MAX_THESIS_LENGTH)
 * - At least MIN_KEY_FACTORS non-empty factors
 * - At least MIN_KEY_RISKS non-empty risks
 * - Confidence is a recognized value
 */
export function validateLLMOutput(result: LLMAnalysisResult): GuardrailResult {
  const reasons: string[] = [];

  // Thesis checks
  if (!result.thesis || result.thesis.trim().length === 0) {
    reasons.push("Thesis is empty");
  } else if (result.thesis.trim().length < MIN_THESIS_LENGTH) {
    reasons.push(`Thesis too short (${result.thesis.trim().length} chars, minimum ${MIN_THESIS_LENGTH})`);
  } else if (result.thesis.length > MAX_THESIS_LENGTH) {
    reasons.push(`Thesis too long (${result.thesis.length} chars, maximum ${MAX_THESIS_LENGTH})`);
  }

  // Key factors checks
  const validFactors = result.keyFactors.filter((f) => f.trim().length > 0);
  if (validFactors.length < MIN_KEY_FACTORS) {
    reasons.push(`Too few key factors (${validFactors.length}, minimum ${MIN_KEY_FACTORS})`);
  }

  // Key risks checks
  const validRisks = result.keyRisks.filter((r) => r.trim().length > 0);
  if (validRisks.length < MIN_KEY_RISKS) {
    reasons.push(`Too few key risks (${validRisks.length}, minimum ${MIN_KEY_RISKS})`);
  }

  // Confidence check (already defaulted in parsing, but belt-and-suspenders)
  if (!["low", "medium", "high"].includes(result.confidence)) {
    reasons.push(`Invalid confidence value: "${result.confidence}"`);
  }

  return { valid: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run LLM-assisted analysis on extracted research signals.
 *
 * Returns null on any failure (network, parse, timeout, bad response).
 * The caller is expected to fall back to heuristic analysis when this returns null.
 */
export async function analyzeWithLLM(
  config: LLMConfig,
  symbol: string,
  signals: ResearchSignals,
  options: { timeoutMs?: number } = {},
): Promise<LLMAnalysisResult | null> {
  const { timeoutMs = 30_000 } = options;

  try {
    const prompt = buildAnalysisPrompt(symbol, signals);

    let response: { content: string; usage?: { prompt_tokens: number; completion_tokens: number } };

    if (config.provider === "anthropic") {
      response = await callAnthropic(config, prompt, timeoutMs);
    } else {
      response = await callOpenAICompatible(config, prompt, timeoutMs);
    }

    if (!response.content) {
      return null;
    }

    const parsed = parseAnalysisResponse(response.content, config.model, response.usage);
    if (!parsed) {
      return null;
    }

    // Apply guardrails — reject degenerate LLM output
    const guardrail = validateLLMOutput(parsed);
    if (!guardrail.valid) {
      console.error(`[llm-analysis] LLM output failed guardrails, falling back to heuristic: ${guardrail.reasons.join("; ")}`);
      return null;
    }

    return parsed;
  } catch (err) {
    // Log but don't throw — caller falls back to heuristic
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[llm-analysis] LLM call failed, falling back to heuristic: ${msg}`);
    return null;
  }
}

// Exported for testing
export { buildAnalysisPrompt, parseAnalysisResponse };
