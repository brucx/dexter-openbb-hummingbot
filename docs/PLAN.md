# Implementation Plan

## Phased approach

Each phase builds on the previous one. No phase should be started until the previous phase works end-to-end. The phases are deliberately small — shipping something that works is better than designing something perfect.

---

## Phase 0: Documentation and Scaffolding

**Goal:** Make the repo feel real. Anyone cloning it should understand what this is, where it's going, and how to contribute.

**Deliverables:**
- README.md with vision, scope, non-goals
- ARCHITECTURE.md with system design
- PLAN.md (this file) with phased roadmap
- TASKS.md with concrete engineering tasks
- Directory structure matching the architecture
- Type definitions for TradeIntent (the shared data format)
- Example configuration files
- Placeholder interfaces for the bridge layer

**Done when:** A developer can clone the repo, read the docs, and understand exactly what to build next.

---

## Phase 1: Read-Only Research Integration with OpenBB

**Goal:** Dexter can use OpenBB as a data source. No trade proposals, no execution — just research.

**Approach:**
1. Stand up OpenBB's REST API (`openbb-api`) as a local service
2. Write a Python bridge script that accepts JSON requests and calls OpenBB
3. Write Dexter tools (LangChain StructuredTools) that call the bridge
4. Register the new tools in Dexter's tool registry
5. Test: ask Dexter a research question and verify it uses OpenBB data

**Key tools to implement first:**
- `openbb_price_history` — OHLCV data for a symbol
- `openbb_quote` — current price, volume, change
- `openbb_financials` — income statement, balance sheet
- `openbb_news` — recent news for a symbol

**Technical decisions:**
- Bridge protocol: JSON Lines over stdin/stdout (simplest, no server to manage)
- OpenBB provider: start with `yfinance` (free, no API key required)
- Error handling: bridge returns `{ "error": "message" }` on failure; Dexter tool surfaces error to agent

**Done when:** You can ask Dexter "What's the current price and recent earnings for AAPL?" and it uses OpenBB tools to answer with live data.

---

## Phase 2: Proposal Generation and Structured Trade Intents

**Goal:** Dexter can produce structured `TradeIntent` proposals with full reasoning, but cannot execute them.

**Approach:**
1. Define the TradeIntent schema as a Dexter tool output format
2. Create a `propose_trade` tool that the agent can call to emit a structured proposal
3. Create a "trade-analysis" skill (SKILL.md) that guides the agent through:
   - Fundamental analysis using OpenBB data
   - Technical analysis using OpenBB indicators
   - Risk assessment
   - Structured proposal generation
4. Build CLI display for trade proposals (formatted, readable)
5. Implement proposal persistence (save to JSON files for review)

**Key constraint:** The `propose_trade` tool emits a proposal but does not execute anything. The proposal is displayed and saved — that's it.

**TradeIntent validation rules:**
- Must include thesis and key_factors (no blind trades)
- Confidence must be specified
- Position size must be within configured limits
- Stop loss required if configured

**Done when:** You can ask Dexter "Should I buy AAPL?" and it produces a structured trade proposal with reasoning, displayed in the CLI, saved to disk. No execution happens.

---

## Phase 3: Hummingbot Paper Trading Bridge

**Goal:** Approved trade proposals can be executed on Hummingbot paper trading connectors.

**Approach:**
1. Write a Python bridge that starts a Hummingbot paper trade connector
2. Bridge accepts approved TradeIntent as JSON, places the order
3. Bridge streams execution events back (fills, cancels)
4. Implement human approval gate in CLI:
   - Display proposal with full context
   - Wait for user input: approve / reject / modify
   - Only send to bridge on approval
5. Track paper trading portfolio state (balances, positions, P&L)

**Technical decisions:**
- Hummingbot connector: `binance_paper_trade` for crypto, extensible later
- Communication: JSON Lines over stdin/stdout (same pattern as OpenBB bridge)
- State persistence: paper portfolio saved to JSON between sessions
- Event reporting: bridge writes events to structured log file

**Paper trading setup:**
- Default starting balance: 10,000 USDT (configurable)
- Supported pairs: BTC-USDT, ETH-USDT initially
- Orders execute against real order book data (Hummingbot's paper trade engine)

**Done when:** You can ask Dexter to analyze BTC, get a trade proposal, approve it in the CLI, and see it execute as a paper trade with fill confirmation.

---

## Phase 4: Safety Wrapper and Guarded Automation

**Goal:** Add configurable risk limits and safety checks between proposal and execution.

**Approach:**
1. Implement risk limit configuration (YAML-based)
2. Build safety validation layer:
   - Position size limits (% of portfolio, absolute USD)
   - Asset whitelist/blacklist
   - Order frequency limits (max N orders per hour)
   - Daily loss limits (stop trading if paper P&L drops below threshold)
   - Duplicate detection (don't open same position twice)
3. Safety wrapper sits between approval gate and execution bridge
4. Rejected proposals get clear explanations of which limit was hit
5. Add portfolio summary command (show current paper positions, P&L)

**Risk configuration example:**
```yaml
# config/safety.yaml
limits:
  max_position_pct: 5.0
  max_order_value_usd: 1000
  max_orders_per_hour: 5
  daily_loss_limit_usd: 500
  require_stop_loss: true

assets:
  allowed: ["BTC-USDT", "ETH-USDT"]
  blocked: []

execution:
  paper_trading_only: true  # hardcoded, not configurable
  confirm_before_execute: true
```

**Done when:** The safety wrapper catches and blocks proposals that violate risk limits, with clear feedback to the user about why.

---

## What's NOT planned

These are things that might seem like natural next steps but are deliberately excluded:

- **Live trading:** This project stays on paper trading. Period.
- **Scheduled/automated research:** Dexter runs when you ask it to, not on a cron.
- **Multi-user support:** One user, one CLI, one paper portfolio.
- **Web UI:** CLI only. A web UI would be a separate project.
- **Backtesting:** Hummingbot has backtesting capabilities, but integrating them is a separate concern.
- **Strategy optimization:** The agent proposes individual trades, not optimized strategies.

## Timeline

No timeline. This is a prototype built incrementally. Each phase is done when it works, not when a deadline says so.
