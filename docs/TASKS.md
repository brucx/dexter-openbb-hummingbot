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
- [ ] Add `.gitignore` for node_modules, .env, Python venv, etc.
- [ ] Add basic `package.json` with TypeScript config

---

## Phase 1: Read-Only Research Integration with OpenBB

### OpenBB Bridge (Python side)
- [ ] Write `src/bridge/openbb_bridge.py` — JSON Lines stdin/stdout bridge
- [ ] Implement `price_history` handler — calls `obb.equity.price.historical()`
- [ ] Implement `quote` handler — calls `obb.equity.price.quote()`
- [ ] Implement `financials` handler — calls `obb.equity.fundamental.*`
- [ ] Implement `news` handler — calls `obb.news.world()`
- [ ] Add error handling and timeout management
- [ ] Write `requirements.txt` for bridge dependencies (openbb, etc.)
- [ ] Manual test: send JSON requests via stdin, verify responses

### Dexter Tools (TypeScript side)
- [ ] Write bridge client utility — spawns Python process, sends/receives JSON Lines
- [ ] Write `openbb_price_history` tool — LangChain StructuredTool wrapping bridge call
- [ ] Write `openbb_quote` tool — current price and volume
- [ ] Write `openbb_financials` tool — income statement, balance sheet, cash flow
- [ ] Write `openbb_news` tool — recent news for a symbol
- [ ] Register all tools in Dexter's tool registry
- [ ] Add tool descriptions optimized for agent understanding

### Integration Testing
- [ ] End-to-end test: Dexter query → OpenBB tool call → data returned → agent uses it
- [ ] Test with multiple providers (yfinance, then FMP if API key available)
- [ ] Test error paths: invalid symbol, provider down, timeout

---

## Phase 2: Proposal Generation and Structured Trade Intents

### Trade Proposal Tool
- [ ] Write `propose_trade` tool — agent calls this to emit a TradeIntent
- [ ] Validate TradeIntent against schema (required fields, value ranges)
- [ ] Write proposal to disk as JSON file in `data/proposals/`
- [ ] Emit `trade_proposal` event in Dexter's event stream

### Trade Analysis Skill
- [ ] Write `src/skills/trade-analysis/SKILL.md` — guided workflow
- [ ] Skill steps: gather data → analyze fundamentals → check technicals → assess risk → propose
- [ ] Register skill in Dexter's skill discovery

### CLI Display
- [ ] Format trade proposal for terminal display (Ink component)
- [ ] Show: asset, direction, size, thesis, confidence, risks
- [ ] Show: relevant data points from research (price, P/E, RSI, etc.)

### Persistence
- [ ] Save proposals to `data/proposals/{id}.json`
- [ ] Add `list_proposals` command to review past proposals
- [ ] Add `show_proposal` command to view a specific proposal

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
