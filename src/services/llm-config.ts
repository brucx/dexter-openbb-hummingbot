/**
 * LLM provider configuration — detects available model API credentials
 * from environment variables and provides a unified config interface.
 *
 * Supports two provider families:
 * - OpenAI-compatible (OpenAI, Azure, local models via OPENAI_API_BASE)
 * - Anthropic (Claude models)
 *
 * Uses the same env vars as config/example.env — no new config story.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider = "openai" | "anthropic";

export interface LLMConfig {
  /** Which provider to use */
  provider: LLMProvider;

  /** API key */
  apiKey: string;

  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
  model: string;

  /** Base URL for the API (OpenAI-compatible only) */
  baseUrl: string;
}

export interface LLMAvailability {
  /** Whether any LLM provider is configured and usable */
  available: boolean;

  /** The resolved config, if available */
  config: LLMConfig | null;

  /** Human-readable reason if not available */
  reason: string;

  /** Which providers were checked and their status */
  checked: { provider: LLMProvider; hasKey: boolean }[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect LLM provider availability from environment variables.
 *
 * Priority:
 * 1. If DEXTER_MODEL is set, infer provider from model name
 * 2. If ANTHROPIC_API_KEY is set, use Anthropic
 * 3. If OPENAI_API_KEY is set, use OpenAI-compatible
 * 4. Otherwise: unavailable
 *
 * Reuses the env vars already documented in config/example.env:
 * - OPENAI_API_KEY, OPENAI_API_BASE
 * - ANTHROPIC_API_KEY
 * - DEXTER_MODEL
 */
export function detectLLMConfig(
  env: Record<string, string | undefined> = process.env,
): LLMAvailability {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim() || "";
  const openaiKey = env.OPENAI_API_KEY?.trim() || "";
  const dexterModel = env.DEXTER_MODEL?.trim() || "";
  const openaiBase = env.OPENAI_API_BASE?.trim() || DEFAULT_OPENAI_BASE;

  const checked: LLMAvailability["checked"] = [
    { provider: "anthropic", hasKey: anthropicKey.length > 0 },
    { provider: "openai", hasKey: openaiKey.length > 0 },
  ];

  // If DEXTER_MODEL hints at a provider, prefer that
  if (dexterModel) {
    const isAnthropicModel =
      dexterModel.startsWith("claude") || dexterModel.includes("anthropic");
    const isOpenAIModel =
      dexterModel.startsWith("gpt") ||
      dexterModel.startsWith("o1") ||
      dexterModel.startsWith("o3") ||
      dexterModel.startsWith("o4");

    if (isAnthropicModel && anthropicKey) {
      return {
        available: true,
        config: {
          provider: "anthropic",
          apiKey: anthropicKey,
          model: dexterModel,
          baseUrl: "https://api.anthropic.com",
        },
        reason: `Using Anthropic (${dexterModel}) from DEXTER_MODEL`,
        checked,
      };
    }

    if (isOpenAIModel && openaiKey) {
      return {
        available: true,
        config: {
          provider: "openai",
          apiKey: openaiKey,
          model: dexterModel,
          baseUrl: openaiBase,
        },
        reason: `Using OpenAI-compatible (${dexterModel}) from DEXTER_MODEL`,
        checked,
      };
    }
  }

  // Fallback: pick whichever key is available
  if (anthropicKey) {
    return {
      available: true,
      config: {
        provider: "anthropic",
        apiKey: anthropicKey,
        model: dexterModel || DEFAULT_ANTHROPIC_MODEL,
        baseUrl: "https://api.anthropic.com",
      },
      reason: `Using Anthropic (${dexterModel || DEFAULT_ANTHROPIC_MODEL})`,
      checked,
    };
  }

  if (openaiKey) {
    return {
      available: true,
      config: {
        provider: "openai",
        apiKey: openaiKey,
        model: dexterModel || DEFAULT_OPENAI_MODEL,
        baseUrl: openaiBase,
      },
      reason: `Using OpenAI-compatible (${dexterModel || DEFAULT_OPENAI_MODEL}) at ${openaiBase}`,
      checked,
    };
  }

  return {
    available: false,
    config: null,
    reason:
      "No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable LLM-assisted analysis. Falling back to heuristic analysis.",
    checked,
  };
}
