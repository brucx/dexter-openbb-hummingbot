# Next Steps — Implementation Pass

## Phase 1: Make End-to-End Solid — COMPLETE

- [x] Bridge client, OpenBB bridge (live + fallback), ResearchService all working
- [x] research-demo.ts runs full pipeline: bridge → research → proposal
- [x] Unit tests pass (18/18)
- [x] Add `requirements.txt` for the Python bridge
- [x] Add integration test: bridge → ResearchService → proposal pipeline (28 tests)
- [x] Update docs/TASKS.md to reflect actual Phase 1 completion state

## Phase 2 Minimum Slice: Proposal Persistence + CLI Display — COMPLETE

- [x] Proposal persistence: save TradeIntent to `data/proposals/<id>.json`
- [x] Load/list saved proposals (`createProposalStore()`)
- [x] CLI formatting: `formatProposal()` for readable terminal output
- [x] CLI formatting: `formatProposalList()` for summary tables
- [x] Demo script uses persistence and formatting end-to-end
- [x] Persistence and format tests (24 tests)
- [x] Update TASKS.md and README for Phase 2 status

## Phase 2.5: Proposal CLI & Review Workflow — COMPLETE

- [x] CLI entry point (`src/cli.ts`) with `proposals` subcommands
- [x] `proposals list` — view all saved proposals with short IDs, filterable by `--status`
- [x] `proposals show <id>` — detailed view of a single proposal (supports prefix matching)
- [x] `proposals approve <id>` — mark a proposal as approved (records who + when)
- [x] `proposals reject <id> --reason "..."` — reject with optional reason
- [x] `updateStatus()` in ProposalStore — persist approval/rejection metadata
- [x] Enhanced `formatProposal()` — shows approval/rejection info, optional ResearchSummary
- [x] `formatProposalList()` — now includes short ID column for easy reference
- [x] Guard against double-approve/reject (only `proposed` status can transition)
- [x] CLI tests (34 tests)
- [x] npm scripts: `cli`, `test:cli`

## Phase 2.6: Proposal Review UX — COMPLETE

Goal: Make `proposals show` useful enough for a human operator to judge a proposal
without re-running research or guessing what data was available.

- [x] Persist research snapshot as sidecar file (`{id}.research.json`) alongside proposals
- [x] Extract key research data points into enriched ResearchSummary (financials, news headlines)
- [x] Show explicit data availability section: which sources succeeded / failed / used fallback
- [x] Enrich `proposals show` with financials highlights (revenue, EPS, net income) and top news
- [x] Add price context (current price, day change) to `proposals list` for faster scanning
- [x] Handle missing/partial research gracefully — honest display, never hidden
- [x] Review UX tests (77 tests)

## Phase 2.7: Partial Research Graceful Degradation — COMPLETE

Goal: Make proposals more honest and robust when some research inputs are missing
or fallback/sample-based. Data quality affects proposal content, not just display.

- [x] `assessDataQuality()` — scores ResearchSnapshot completeness (live/fallback/missing per source)
- [x] Confidence capping: proposal confidence auto-capped based on data availability
  - Quote missing → max "low" (no price = no conviction)
  - Any core source (quote/history/financials) missing → max "medium"
  - Core sources present but fallback → max "medium"
  - All core sources live → max "high" (news is supplementary)
- [x] Thesis caveats: auto-prefixed with `[LIMITED DATA]` or `[WEAK EVIDENCE]` when warranted
- [x] Risk injection: data-gap risks auto-appended to `key_risks` (no duplicates)
- [x] `DataQualityAssessment` attached to every `ProposalResult` for downstream consumers
- [x] Data quality tests (32 tests)

## Phase 2.8: Trade Analysis Workflow — COMPLETE

Goal: Provide a single CLI entrypoint that runs the full research → proposal
pipeline, replacing the ad-hoc demo script with a proper workflow command.

- [x] `analyzeSymbol()` workflow function — thin orchestrator composing research, proposal, persistence
- [x] `analyze <SYMBOL>` CLI command — first-class entrypoint for the pipeline
- [x] Data quality summary printed before proposal display
- [x] Explicit next-step guidance: output tells user how to review/approve/reject
- [x] Workflow spec document (`docs/WORKFLOW.md`)
- [x] Workflow tests
- [x] Updated npm scripts (`test:workflow`, `test:all`)

## Phase 2.9: Proposal Content Quality — COMPLETE

Goal: Make auto-draft proposals noticeably more useful by grounding thesis, factors,
and risks in actual research data instead of generic placeholders.

- [x] `extractSignals()` — mine concrete observations from ResearchSnapshot
  - Price signals: current price, day change, 30-day range, range position, trend direction, period change %
  - Financial signals: revenue, net income, EPS, profitability flag
  - News signals: article count, top headlines, recency
- [x] Grounded thesis generation — references actual price, trend, revenue, profitability
  - Cautious when data is thin: "Insufficient live data" instead of generic filler
  - Always marked [AUTO-DRAFT] — never pretends to be real analysis
- [x] Grounded key_factors — concrete data points (price, volume, market cap, P/E, range, trend, financials, news headlines)
  - Includes transparent "Live data sources used" note
- [x] Grounded key_risks — specific to observed data
  - Downward trend flagged when detected
  - High P/E flagged (>40)
  - Negative P/E flagged
  - Unprofitability flagged from financials
  - Missing data sources flagged individually
- [x] Fallback/sample data treated as absent for signal extraction (honest, not misleading)
- [x] Signal extraction tests (12 tests) + grounded content tests (17 tests) = 57 total data-quality tests
- [x] Full test suite passes (245 tests)

## Phase 2.10: LLM-Assisted Analysis Layer — COMPLETE

Goal: Introduce an optional LLM analysis path that improves thesis/factors/risks
quality by having a language model synthesize research signals, while keeping the
heuristic generator as a reliable fallback.

- [x] `detectLLMConfig()` — auto-detect LLM provider from env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, DEXTER_MODEL, OPENAI_API_BASE)
  - Supports Anthropic and OpenAI-compatible providers
  - Reuses existing config/example.env env var conventions
  - Reports availability status with diagnostics
- [x] `analyzeWithLLM()` — LLM analysis service using raw fetch (no SDK dependencies)
  - Grounded prompt: model only sees extracted signals, never raw data
  - Honest: instructions to flag uncertainty, never invent facts
  - Structured JSON output: thesis, keyFactors, keyRisks, confidence
  - 30s timeout, graceful error handling → returns null on any failure
- [x] `autoDraftProposalWithLLM()` — async proposal generation with fallback chain
  - LLM available + succeeds → LLM-generated content (marked [LLM-DRAFT])
  - LLM unavailable or fails → heuristic fallback (existing autoDraftProposal)
  - Data quality constraints still applied: confidence capping, risk injection, caveats
  - ProposalResult extended: `usedLLMAnalysis`, `llmModel` fields
- [x] Workflow integration: `analyzeSymbol()` tries LLM path when available
  - `useLLM` option (default: true) for caller control
  - `AnalyzeResult` extended: `usedLLMAnalysis`, `llmStatus` fields
- [x] Tests: 21 new tests (config detection, prompt construction, response parsing, fallback chain)
- [x] Full test suite passes (266 tests)

## Phase 2.11: LLM Governance — Observability & Guardrails — COMPLETE

Goal: Make analysis mode (LLM vs heuristic) visible to human reviewers, and add
lightweight guardrails that reject degenerate LLM output with automatic heuristic fallback.

- [x] Analysis mode visibility in CLI proposal output
  - `formatProposal()` accepts `AnalysisModeInfo` and shows "Analysis: LLM (model)" or "Analysis: Heuristic (reason)"
  - CLI `analyze` command passes analysis mode through to display
  - `[LLM-DRAFT via <model>]` thesis marker includes model attribution
  - `[AUTO-DRAFT]` marker preserved for heuristic path
- [x] Lightweight LLM output guardrails (`validateLLMOutput()`)
  - Thesis must be non-empty and ≥20 characters (rejects empty/trivial output)
  - Thesis must be ≤5000 characters (rejects garbage/runaway output)
  - At least 1 non-empty key factor required
  - At least 1 non-empty key risk required
  - Confidence must be a recognized value
  - Guardrail failures logged with reasons, trigger automatic heuristic fallback
  - All checks are deterministic — no AI moderation
- [x] Tests: 17 new tests (12 guardrail + 5 analysis mode visibility) → 283 total

## Phase 2.12: LLM Token Usage Observability (completed)

Surface LLM token consumption per proposal so reviewers can see resource usage at a glance.

- [x] `ProposalResult.llmTokenUsage` — captures prompt, completion, and total token counts
- [x] `AnalysisModeInfo.tokenUsage` — carries token data to the display layer
- [x] `AnalyzeResult.llmTokenUsage` — workflow propagates token usage to CLI
- [x] `formatProposal()` shows `Tokens: N (prompt + completion)` line when LLM was used
- [x] Token usage never displayed for heuristic-only analysis
- [x] CLI `analyze` command passes token usage through to formatter
- [x] No cost display — deferred (pricing varies by provider/model, better to show raw tokens than speculative cost math)
- [x] Tests: 4 new token usage visibility tests → 287 total (44 in LLM test file)

## Next Implementation Target

- [ ] LLM governance: rate limiting / circuit breaker for LLM API calls
- [ ] Emit `trade_proposal` event for Dexter event stream integration
- [ ] Phase 3: Hummingbot paper trading bridge (when ready)
- [ ] LLM analysis: multi-turn refinement (follow-up questions when data is ambiguous)
- [ ] LLM analysis: comparative analysis (vs sector, vs historical)
- [ ] Deeper financial analysis: multi-period comparison, margin trends, debt ratios
- [ ] Technical indicators: moving averages, RSI, volume patterns from price history
