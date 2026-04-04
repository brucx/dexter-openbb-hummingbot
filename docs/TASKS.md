# Engineering Tasks

Concrete work items grouped by phase. Each task is small enough to be a single PR.

---

## Phase 0: Documentation and Scaffolding

- [x] Write README.md with vision, scope, non-goals
- [x] Write docs/ARCHITECTURE.md with system design
- [x] Write docs/PLAN.md with phased roadmap
- [x] Write docs/TASKS.md (this file)
- [x] Create directory structure: `src/types/`, `src/tools/`, `src/bridge/`, `src/safety/`
- [x] Define TradeIntent TypeScript interface in `src/types/trade-intent.ts`
- [x] Define bridge protocol types in `src/types/bridge-protocol.ts`
- [x] Create `config/example.env` with all required environment variables
- [x] Create `config/safety.example.yaml` with default risk limits
- [x] Add `.gitignore` for node_modules, .env, Python venv, etc.
- [x] Add basic `package.json` with TypeScript config

---

## Phase 1: Read-Only Research Integration with OpenBB

### OpenBB Bridge (Python side)
- [x] Write `src/bridge/openbb_bridge.py` — JSON Lines stdin/stdout bridge
- [x] Implement `price_history` handler — calls `obb.equity.price.historical()`
- [x] Implement `quote` handler — calls `obb.equity.price.quote()`
- [x] Implement `financials` handler — calls `obb.equity.fundamental.*`
- [x] Implement `news` handler — calls `obb.news.world()`
- [x] Add error handling and timeout management
- [x] Add deterministic fallback mode when OpenBB SDK is not installed
- [x] Write `requirements.txt` for bridge dependencies (openbb, etc.)
- [x] Manual test: send JSON requests via stdin, verify responses (`examples/bridge-test.ts`)

### Dexter Tools (TypeScript side)
- [x] Write bridge client utility — spawns Python process, sends/receives JSON Lines (`src/bridge/bridge-client.ts`)
- [x] Write research service with `getQuote`, `getPriceHistory`, `getFinancials`, `getNews` (`src/services/research.ts`)
- [x] Write combined `research()` method for full snapshot
- [x] Normalize bridge responses into typed interfaces
- [ ] Write LangChain StructuredTool wrappers (deferred to Dexter integration)
- [ ] Register all tools in Dexter's tool registry (deferred to Dexter integration)
- [ ] Add tool descriptions optimized for agent understanding (deferred to Dexter integration)

### Integration Testing
- [x] Bridge protocol test: `examples/bridge-test.ts`
- [x] End-to-end research → proposal demo: `examples/research-demo.ts`
- [x] Unit tests for validation and proposal building: `src/tests/validate-trade-intent.test.ts`
- [x] Integration test: bridge → service → proposal pipeline: `src/tests/research-integration.test.ts`
- [x] Persistence and formatting tests: `src/tests/persistence-format.test.ts`
- [ ] Test with multiple providers (yfinance, then FMP if API key available)
- [ ] Test error paths: invalid symbol, provider down, timeout

---

## Phase 2: Proposal Generation and Structured Trade Intents

### Trade Proposal Tool
- [x] Write `buildProposal()` — shapes research + parameters into validated TradeIntent (`src/services/proposal.ts`)
- [x] Write `autoDraftProposal()` — convenience auto-draft for demo/testing
- [x] Validate TradeIntent against schema (required fields, value ranges)
- [x] Write proposal to disk as JSON file in `data/proposals/` (`src/services/persistence.ts`)
- [ ] Emit `trade_proposal` event in Dexter's event stream

### Trade Analysis Workflow
- [x] Write `analyzeSymbol()` workflow function (`src/services/workflow.ts`)
- [x] Add `analyze <SYMBOL>` CLI command to `src/cli.ts`
- [x] Write workflow spec document (`docs/WORKFLOW.md`)
- [x] Add workflow tests (`src/tests/workflow.test.ts`)
- [x] Grounded proposal content: signal extraction + data-driven thesis/factors/risks (Phase 2.9)
- [ ] Agent-driven analysis: replace heuristic thesis with LLM-synthesized reasoning (future)
- [ ] Register as Dexter skill when skill discovery is available (future)

### CLI Display
- [x] Format trade proposal for terminal display (`src/services/format.ts`)
- [x] Show: asset, direction, size, thesis, confidence, risks
- [x] Show: relevant data points from research via ResearchSummary (price, P/E, volume, etc.)
- [x] Show: approval/rejection metadata in formatted output
- [x] Enrich `proposals show` with financials highlights, news headlines, data availability
- [x] Add price context to `proposals list` for faster scanning
- [x] Persist research snapshot as sidecar for later review display

### Persistence
- [x] Save proposals to `data/proposals/{id}.json` (`src/services/persistence.ts`)
- [x] Add `loadAll()` / `list()` to review past proposals
- [x] Add `load(id)` to view a specific proposal
- [x] Add `updateStatus()` — approve/reject proposals with metadata
- [x] Add CLI commands wrapping persistence (`src/cli.ts`: list, show, approve, reject)

---

## Phase 2.7: Partial Research Graceful Degradation

### Data Quality Assessment
- [x] `assessDataQuality(ResearchSnapshot)` — per-source status (live/fallback/missing), counts, max confidence
- [x] Confidence capping in `buildProposal()` — caps requested confidence to data-justified max
- [x] Thesis caveats — auto-prefix `[LIMITED DATA]` or `[WEAK EVIDENCE]` based on gap severity
- [x] Risk injection — auto-append data-gap warnings to `key_risks`, deduplicated
- [x] `DataQualityAssessment` type exported and attached to `ProposalResult`
- [x] Updated `autoDraftProposal()` — removed manual fallback risk (now handled by buildProposal)
- [x] Data quality tests: 32 tests covering assessment, capping, caveats, risk injection
- [x] Updated existing tests to reflect confidence capping behavior

---

## Phase 2.11: LLM Governance — Observability & Guardrails

### Analysis Mode Visibility
- [x] `AnalysisModeInfo` type in `src/services/format.ts` — captures LLM/heuristic mode, model name, fallback reason
- [x] `formatProposal()` shows "Analysis: LLM (model)" or "Analysis: Heuristic — reason" in proposal box
- [x] CLI `analyze` command passes `AnalysisModeInfo` to formatter
- [x] `[LLM-DRAFT via <model>]` thesis prefix includes model attribution
- [x] 5 analysis mode visibility tests

### LLM Output Guardrails
- [x] `validateLLMOutput()` in `src/services/llm-analysis.ts` — deterministic validation of LLM output
- [x] Guardrail: thesis non-empty and ≥20 chars
- [x] Guardrail: thesis ≤5000 chars (reject runaway output)
- [x] Guardrail: at least 1 non-empty key factor
- [x] Guardrail: at least 1 non-empty key risk
- [x] Guardrail: confidence is a recognized value
- [x] `analyzeWithLLM()` applies guardrails after parsing — invalid output → null → heuristic fallback
- [x] Guardrail failures logged with specific reasons
- [x] 12 guardrail tests
- [x] Full test suite passes (283 tests)

---

## Phase 2.12: LLM Token Usage Observability

### Token Usage Surfacing
- [x] `ProposalResult.llmTokenUsage` field — `{ promptTokens, completionTokens, totalTokens }`
- [x] `autoDraftProposalWithLLM()` propagates usage from `LLMAnalysisResult` to `ProposalResult`
- [x] `AnalysisModeInfo.tokenUsage` carries token data to display layer
- [x] `formatProposal()` shows "Tokens: N (prompt + completion)" when LLM was used
- [x] Token line omitted when no usage data available or heuristic path used
- [x] `AnalyzeResult.llmTokenUsage` in workflow — propagated to CLI
- [x] CLI `analyze` passes token usage into `AnalysisModeInfo` for display
- [x] Cost display intentionally deferred (pricing assumptions too speculative)
- [x] 4 new tests: token display, no-usage-data, heuristic-clean, fallback-clean
- [x] Full test suite passes (287 tests across all files)

---

## Phase 3: Hummingbot Paper Trading Bridge

### Hummingbot Bridge (Python side)
- [ ] Write `src/bridge/hummingbot_bridge.py` — JSON Lines stdin/stdout bridge
- [ ] Implement connector initialization (paper trade mode)
- [ ] Implement `place_order` handler — translates TradeIntent to buy/sell call
- [ ] Implement `cancel_order` handler
- [ ] Implement `get_balances` handler
- [ ] Implement `get_positions` handler
- [ ] Stream execution events back as JSON Lines
- [ ] Handle connector lifecycle (start, stop, reconnect)

### Human Approval Gate
- [ ] Build approval prompt in CLI (Ink component)
- [ ] Display proposal with full context
- [ ] Accept: approve, reject, modify (re-enter to edit fields)
- [ ] Log approval decision with timestamp
- [ ] Route approved intents to Hummingbot bridge

### Portfolio Tracking
- [ ] Track paper portfolio state in `data/portfolio.json`
- [ ] Update on fills: adjust balances, record position
- [ ] Calculate unrealized P&L using current prices
- [ ] Add `portfolio` CLI command to show current state

### Event Logging
- [ ] Write execution events to `data/events/` as JSON Lines
- [ ] Events: order_placed, order_filled, order_cancelled, balance_changed
- [ ] Add `events` CLI command to show recent events

---

## Phase 4: Safety Wrapper and Guarded Automation

### Risk Limit Engine
- [ ] Parse `config/safety.yaml` into typed config
- [ ] Implement position size check (% of portfolio)
- [ ] Implement absolute order value check (USD limit)
- [ ] Implement asset whitelist/blacklist check
- [ ] Implement order frequency limit (max per hour)
- [ ] Implement daily loss limit (stop after threshold)
- [ ] Implement duplicate position detection

### Safety Integration
- [ ] Wire safety checks between proposal and approval gate
- [ ] Block proposals that fail safety checks with clear error messages
- [ ] Allow user to override specific checks with explicit confirmation
- [ ] Log all safety check results (pass and fail) for audit

### Portfolio Commands
- [ ] `portfolio summary` — current positions, P&L, exposure
- [ ] `portfolio history` — closed positions and realized P&L
- [ ] `portfolio risk` — current exposure vs. configured limits
