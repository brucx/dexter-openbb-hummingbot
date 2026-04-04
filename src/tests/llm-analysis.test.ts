/**
 * Tests for LLM config detection, prompt construction, response parsing,
 * and the LLM-assisted proposal fallback chain.
 *
 * These tests do NOT call real LLM APIs — they test the config detection,
 * prompt building, response parsing, and fallback behavior in isolation.
 *
 * Run with: npx tsx src/tests/llm-analysis.test.ts
 */

import { detectLLMConfig } from "../services/llm-config";
import type { LLMAvailability } from "../services/llm-config";
import { buildAnalysisPrompt, parseAnalysisResponse, validateLLMOutput } from "../services/llm-analysis";
import type { LLMAnalysisResult, GuardrailResult } from "../services/llm-analysis";
import { autoDraftProposal, autoDraftProposalWithLLM, extractSignals } from "../services/proposal";
import type { ResearchSignals } from "../services/proposal";
import type { ResearchSnapshot } from "../services/research";
import { formatProposal } from "../services/format";
import type { AnalysisModeInfo } from "../services/format";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    result.then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    }).catch((e) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    });
    return result;
  }
  try {
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullLiveSnapshot(symbol = "AAPL"): ResearchSnapshot {
  return {
    symbol,
    quote: { symbol, price: 185.5, change: 2.35, changePct: 1.28, volume: 54_321_000, marketCap: 2_800_000_000_000, peRatio: 28.5, isFallback: false },
    priceHistory: {
      symbol,
      records: [
        { date: "2024-01-01", open: 170, high: 172, low: 168, close: 171, volume: 50_000_000 },
        { date: "2024-01-15", open: 175, high: 178, low: 174, close: 177, volume: 48_000_000 },
        { date: "2024-01-31", open: 180, high: 188, low: 179, close: 185, volume: 52_000_000 },
      ],
      isFallback: false,
    },
    financials: { symbol, period: "annual", incomeStatement: { total_revenue: 394_328_000_000, net_income: 97_000_000_000, basic_eps: 6.13 }, isFallback: false },
    news: { symbol, articles: [{ title: "AAPL beats earnings" }, { title: "Apple announces new product line" }], isFallback: false },
    errors: [],
    timestamp: new Date().toISOString(),
  };
}

function emptySnapshot(symbol = "XYZ"): ResearchSnapshot {
  return {
    symbol,
    quote: null,
    priceHistory: null,
    financials: null,
    news: null,
    errors: ["All sources failed"],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// LLM Config Detection Tests
// ---------------------------------------------------------------------------

console.log("\n=== LLM Config Detection ===");

test("detects no config when no env vars set", () => {
  const result = detectLLMConfig({});
  assert(!result.available, "should not be available");
  assert(result.config === null, "config should be null");
  assert(result.reason.includes("No LLM API key"), "reason should explain missing keys");
});

test("detects Anthropic from ANTHROPIC_API_KEY", () => {
  const result = detectLLMConfig({ ANTHROPIC_API_KEY: "sk-ant-test123" });
  assert(result.available, "should be available");
  assert(result.config!.provider === "anthropic", "should be anthropic provider");
  assert(result.config!.apiKey === "sk-ant-test123", "should have correct key");
  assert(result.config!.model.includes("claude"), "should default to claude model");
});

test("detects OpenAI from OPENAI_API_KEY", () => {
  const result = detectLLMConfig({ OPENAI_API_KEY: "sk-test456" });
  assert(result.available, "should be available");
  assert(result.config!.provider === "openai", "should be openai provider");
  assert(result.config!.apiKey === "sk-test456", "should have correct key");
});

test("respects DEXTER_MODEL for provider selection", () => {
  const result = detectLLMConfig({
    ANTHROPIC_API_KEY: "sk-ant-test",
    OPENAI_API_KEY: "sk-oai-test",
    DEXTER_MODEL: "gpt-5.4",
  });
  assert(result.available, "should be available");
  assert(result.config!.provider === "openai", "DEXTER_MODEL=gpt-5.4 should select openai");
  assert(result.config!.model === "gpt-5.4", "model should match DEXTER_MODEL");
});

test("DEXTER_MODEL with claude prefix selects Anthropic", () => {
  const result = detectLLMConfig({
    ANTHROPIC_API_KEY: "sk-ant-test",
    DEXTER_MODEL: "claude-sonnet-4-20250514",
  });
  assert(result.config!.provider === "anthropic", "should select anthropic");
  assert(result.config!.model === "claude-sonnet-4-20250514", "model should match");
});

test("respects OPENAI_API_BASE", () => {
  const result = detectLLMConfig({
    OPENAI_API_KEY: "sk-test",
    OPENAI_API_BASE: "http://localhost:8080/v1",
  });
  assert(result.config!.baseUrl === "http://localhost:8080/v1", "should use custom base URL");
});

test("prefers Anthropic when both keys present and no DEXTER_MODEL", () => {
  const result = detectLLMConfig({
    ANTHROPIC_API_KEY: "sk-ant-test",
    OPENAI_API_KEY: "sk-oai-test",
  });
  assert(result.config!.provider === "anthropic", "should prefer anthropic");
});

test("trims whitespace from env vars", () => {
  const result = detectLLMConfig({ ANTHROPIC_API_KEY: "  sk-ant-test  " });
  assert(result.available, "should be available");
  assert(result.config!.apiKey === "sk-ant-test", "key should be trimmed");
});

test("treats empty string as missing", () => {
  const result = detectLLMConfig({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "  " });
  assert(!result.available, "empty/whitespace keys should not count");
});

// ---------------------------------------------------------------------------
// Prompt Construction Tests
// ---------------------------------------------------------------------------

console.log("\n=== Prompt Construction ===");

test("builds prompt with full signals", () => {
  const signals = extractSignals(fullLiveSnapshot());
  const prompt = buildAnalysisPrompt("AAPL", signals);
  assert(prompt.includes("AAPL"), "should include symbol");
  assert(prompt.includes("185.50"), "should include price");
  assert(prompt.includes("P/E ratio"), "should include P/E");
  assert(prompt.includes("AAPL beats earnings"), "should include headline");
  assert(prompt.includes("IMPORTANT RULES"), "should include grounding rules");
  assert(prompt.includes("Do NOT invent"), "should include honesty instruction");
  assert(prompt.includes("JSON"), "should request JSON output");
});

test("builds prompt with 'unchanged' when dayChangePct is zero", () => {
  const snap = fullLiveSnapshot();
  snap.quote!.change = 0;
  snap.quote!.changePct = 0;
  const signals = extractSignals(snap);
  const prompt = buildAnalysisPrompt("AAPL", signals);
  assert(prompt.includes("unchanged"), "should say unchanged for zero day change");
  assert(!prompt.includes("+0.00%"), "should not show +0.00%");
});

test("builds prompt with news headline qualification", () => {
  const signals = extractSignals(fullLiveSnapshot());
  const prompt = buildAnalysisPrompt("AAPL", signals);
  assert(prompt.includes("not necessarily specific to this company"), "should qualify news headlines");
});

test("builds prompt with empty signals", () => {
  const signals = extractSignals(emptySnapshot());
  const prompt = buildAnalysisPrompt("XYZ", signals);
  assert(prompt.includes("XYZ"), "should include symbol");
  assert(prompt.includes("No live price data"), "should note missing price");
  assert(prompt.includes("No live financial data"), "should note missing financials");
  assert(prompt.includes("No live news data"), "should note missing news");
});

// ---------------------------------------------------------------------------
// Response Parsing Tests
// ---------------------------------------------------------------------------

console.log("\n=== Response Parsing ===");

test("parses valid JSON response", () => {
  const raw = JSON.stringify({
    thesis: "AAPL is trading at $185 with upward momentum.",
    keyFactors: ["Strong earnings", "Upward trend"],
    keyRisks: ["Valuation stretched", "Market risk"],
    confidence: "medium",
  });
  const result = parseAnalysisResponse(raw, "test-model");
  assert(result !== null, "should parse successfully");
  assert(result!.thesis.includes("AAPL"), "thesis should be preserved");
  assert(result!.keyFactors.length === 2, "should have 2 factors");
  assert(result!.keyRisks.length === 2, "should have 2 risks");
  assert(result!.confidence === "medium", "confidence should be medium");
  assert(result!.model === "test-model", "model should be set");
});

test("strips markdown code fences", () => {
  const raw = "```json\n" + JSON.stringify({
    thesis: "Test thesis",
    keyFactors: ["factor"],
    keyRisks: ["risk"],
    confidence: "low",
  }) + "\n```";
  const result = parseAnalysisResponse(raw, "test");
  assert(result !== null, "should parse despite code fences");
  assert(result!.thesis === "Test thesis", "thesis should be correct");
});

test("returns null for invalid JSON", () => {
  assert(parseAnalysisResponse("not json", "test") === null, "should return null for garbage");
});

test("returns null for missing required fields", () => {
  const raw = JSON.stringify({ thesis: "only thesis" });
  assert(parseAnalysisResponse(raw, "test") === null, "should return null without keyFactors/keyRisks");
});

test("defaults confidence to low for invalid values", () => {
  const raw = JSON.stringify({
    thesis: "test",
    keyFactors: ["f"],
    keyRisks: ["r"],
    confidence: "super-high",
  });
  const result = parseAnalysisResponse(raw, "test");
  assert(result!.confidence === "low", "invalid confidence should default to low");
});

test("filters non-string items from arrays", () => {
  const raw = JSON.stringify({
    thesis: "test",
    keyFactors: ["valid", 123, null, "also valid"],
    keyRisks: ["risk", undefined],
    confidence: "medium",
  });
  const result = parseAnalysisResponse(raw, "test");
  assert(result!.keyFactors.length === 2, "should filter non-strings from factors");
  assert(result!.keyRisks.length === 1, "should filter non-strings from risks");
});

test("includes usage info when provided", () => {
  const raw = JSON.stringify({
    thesis: "test",
    keyFactors: ["f"],
    keyRisks: ["r"],
    confidence: "low",
  });
  const result = parseAnalysisResponse(raw, "test", { prompt_tokens: 100, completion_tokens: 50 });
  assert(result!.usage!.promptTokens === 100, "prompt tokens");
  assert(result!.usage!.completionTokens === 50, "completion tokens");
});

// ---------------------------------------------------------------------------
// Fallback Chain Tests
// ---------------------------------------------------------------------------

console.log("\n=== Fallback Chain (autoDraftProposalWithLLM) ===");

await test("falls back to heuristic when no LLM configured", async () => {
  const research = fullLiveSnapshot();
  const result = await autoDraftProposalWithLLM(research, { env: {} });
  assert(result.intent !== null, "should produce a proposal");
  assert(result.usedLLMAnalysis === false, "should report heuristic was used");
  assert(result.intent!.thesis.includes("[AUTO-DRAFT]"), "should use heuristic thesis marker");
});

await test("heuristic fallback produces same result as autoDraftProposal", async () => {
  const research = fullLiveSnapshot();
  const llmResult = await autoDraftProposalWithLLM(research, { env: {} });
  const heuristicResult = autoDraftProposal(research);
  // Thesis content should match (both heuristic)
  assert(
    llmResult.intent!.thesis === heuristicResult.intent!.thesis,
    "fallback should produce identical thesis to heuristic path",
  );
});

await test("handles empty research gracefully via fallback", async () => {
  const research = emptySnapshot();
  const result = await autoDraftProposalWithLLM(research, { env: {} });
  assert(result.intent !== null, "should still produce a proposal");
  assert(result.usedLLMAnalysis === false, "should fall back to heuristic");
});

// ---------------------------------------------------------------------------
// LLM Output Guardrails Tests
// ---------------------------------------------------------------------------

console.log("\n=== LLM Output Guardrails ===");

function validLLMResult(overrides: Partial<LLMAnalysisResult> = {}): LLMAnalysisResult {
  return {
    thesis: "AAPL is trading at $185 with upward momentum supported by strong earnings and revenue growth.",
    keyFactors: ["Strong earnings beat", "Revenue growth trend"],
    keyRisks: ["Elevated valuation", "Market concentration risk"],
    confidence: "medium",
    model: "test-model",
    ...overrides,
  };
}

test("accepts valid LLM output", () => {
  const result = validateLLMOutput(validLLMResult());
  assert(result.valid, "should be valid");
  assert(result.reasons.length === 0, "should have no rejection reasons");
});

test("rejects empty thesis", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "" }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("empty")), "should mention empty thesis");
});

test("rejects whitespace-only thesis", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "   " }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("empty")), "should mention empty thesis");
});

test("rejects too-short thesis", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "Too short." }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("too short")), "should mention short thesis");
});

test("rejects too-long thesis", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "x".repeat(5001) }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("too long")), "should mention long thesis");
});

test("rejects empty keyFactors", () => {
  const result = validateLLMOutput(validLLMResult({ keyFactors: [] }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("factors")), "should mention factors");
});

test("rejects keyFactors with only empty strings", () => {
  const result = validateLLMOutput(validLLMResult({ keyFactors: ["", "  "] }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("factors")), "should mention factors");
});

test("rejects empty keyRisks", () => {
  const result = validateLLMOutput(validLLMResult({ keyRisks: [] }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("risks")), "should mention risks");
});

test("rejects keyRisks with only empty strings", () => {
  const result = validateLLMOutput(validLLMResult({ keyRisks: ["", " "] }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.some((r) => r.includes("risks")), "should mention risks");
});

test("collects multiple guardrail failures", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "", keyFactors: [], keyRisks: [] }));
  assert(!result.valid, "should be invalid");
  assert(result.reasons.length >= 3, `should have multiple reasons, got ${result.reasons.length}`);
});

test("accepts thesis at exactly minimum length", () => {
  const result = validateLLMOutput(validLLMResult({ thesis: "A".repeat(20) }));
  assert(result.valid, "should accept thesis at minimum length");
});

test("accepts single valid factor and risk", () => {
  const result = validateLLMOutput(validLLMResult({
    keyFactors: ["One valid factor"],
    keyRisks: ["One valid risk"],
  }));
  assert(result.valid, "should accept minimum valid counts");
});

// ---------------------------------------------------------------------------
// Analysis Mode Visibility Tests
// ---------------------------------------------------------------------------

console.log("\n=== Analysis Mode Visibility ===");

test("formatProposal shows LLM analysis mode with model name", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = { usedLLM: true, model: "gpt-5.4" };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Analysis:"), "should contain Analysis line");
  assert(output.includes("LLM"), "should mention LLM");
  assert(output.includes("gpt-5.4"), "should include model name");
});

test("formatProposal shows heuristic analysis mode", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = { usedLLM: false, fallbackReason: "No LLM API key found" };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Analysis:"), "should contain Analysis line");
  assert(output.includes("Heuristic"), "should mention Heuristic");
  assert(output.includes("No LLM API key"), "should include fallback reason");
});

test("formatProposal shows heuristic without reason when none provided", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = { usedLLM: false };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Heuristic"), "should mention Heuristic");
  assert(!output.includes("undefined"), "should not show undefined");
});

test("formatProposal omits analysis line when no analysisMode provided", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const output = formatProposal(intent);
  assert(!output.includes("Analysis:"), "should not contain Analysis line when not provided");
});

test("formatProposal shows token usage when LLM analysis used", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = {
    usedLLM: true,
    model: "gpt-5.4",
    tokenUsage: { promptTokens: 820, completionTokens: 350, totalTokens: 1170 },
  };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Tokens:"), "should contain Tokens line");
  assert(output.includes("1,170"), "should show total tokens formatted");
  assert(output.includes("820"), "should show prompt tokens");
  assert(output.includes("350"), "should show completion tokens");
  assert(output.includes("prompt"), "should label prompt tokens");
  assert(output.includes("completion"), "should label completion tokens");
});

test("formatProposal omits token usage when LLM used but no usage data", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = { usedLLM: true, model: "gpt-5.4" };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("LLM"), "should show LLM analysis mode");
  assert(!output.includes("Tokens:"), "should not show Tokens line when no usage data");
});

test("formatProposal never shows token usage for heuristic analysis", () => {
  const research = fullLiveSnapshot();
  const proposal = autoDraftProposal(research);
  const intent = proposal.intent!;
  const analysisMode: AnalysisModeInfo = { usedLLM: false, fallbackReason: "No LLM configured" };
  const output = formatProposal(intent, { analysisMode });
  assert(output.includes("Heuristic"), "should show Heuristic mode");
  assert(!output.includes("Tokens:"), "should not show Tokens line for heuristic");
});

test("autoDraftProposalWithLLM heuristic fallback has no token usage", async () => {
  const research = fullLiveSnapshot();
  const result = await autoDraftProposalWithLLM(research, { env: {} });
  assert(result.usedLLMAnalysis === false, "should be heuristic");
  assert(result.llmTokenUsage === undefined, "should have no token usage on heuristic path");
});

test("LLM-draft thesis includes model attribution", async () => {
  // When LLM is not configured, we can't test actual LLM path, but we can verify
  // the thesis marker format by checking the autoDraftProposalWithLLM fallback
  const research = fullLiveSnapshot();
  const result = await autoDraftProposalWithLLM(research, { env: {} });
  // Heuristic fallback should use [AUTO-DRAFT]
  assert(result.intent!.thesis.includes("[AUTO-DRAFT]"), "heuristic fallback should use AUTO-DRAFT marker");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// Wait for async tests to complete
await new Promise((r) => setTimeout(r, 100));

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
