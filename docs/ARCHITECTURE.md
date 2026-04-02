# Architecture

## Overview

This system connects three open-source projects into a research-to-execution pipeline:

1. **Dexter** — AI agent that performs multi-step financial research
2. **OpenBB** — Unified market data and analysis toolkit
3. **Hummingbot** — Trading execution framework with paper trading

The key architectural principle: **information flows down, approval flows up.** Dexter produces research and trade proposals. Humans review and approve. Only then does anything reach the execution layer.

## System diagram

```
                    ┌──────────────┐
                    │   User CLI   │
                    └──────┬───────┘
                           │ query
                           ▼
                    ┌──────────────┐
                    │    Dexter    │
                    │  Agent Loop  │◄──── SOUL.md + RULES.md
                    └──────┬───────┘
                           │ tool calls
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌────────┐ ┌──────────┐
       │ OpenBB     │ │ Web    │ │ Dexter   │
       │ Tools      │ │ Search │ │ Finance  │
       │ (new)      │ │ (ext.) │ │ Tools    │
       └────────────┘ └────────┘ └──────────┘
              │
              │ market data, fundamentals,
              │ technical analysis
              ▼
       ┌──────────────┐
       │  Dexter      │
       │  Synthesis    │──── research output + reasoning
       └──────┬───────┘
              │ TradeIntent (structured proposal)
              ▼
       ┌──────────────┐
       │   Safety     │
       │   Wrapper    │──── risk limits, position checks
       └──────┬───────┘
              │ validated proposal
              ▼
       ┌──────────────┐
       │   Human      │
       │   Approval   │──── approve / reject / modify
       └──────┬───────┘
              │ approved TradeIntent
              ▼
       ┌──────────────┐
       │  Hummingbot  │
       │  Bridge      │──── paper trade connectors only
       └──────┬───────┘
              │ execution events
              ▼
       ┌──────────────┐
       │  Event Log   │──── fills, cancels, balances
       └──────────────┘
```

## Component details

### Dexter (Orchestration Layer)

Dexter is a TypeScript-based AI agent built on LangChain. It runs an iterative tool-calling loop: receive a query, decompose it into steps, call tools, synthesize results, and either continue researching or produce a final answer.

**What we use from Dexter:**
- Agent loop with streaming events (`Agent.run()` → `AsyncGenerator<AgentEvent>`)
- Tool registry for registering new tools (OpenBB tools, execution tools)
- Skill system for multi-step workflows (e.g., a "trade proposal" skill)
- Memory system for persisting research context across sessions
- Scratchpad for audit trail of all tool calls and reasoning

**What we extend:**
- New tools that call OpenBB for market data
- New tools that format and submit trade proposals
- A "trade-proposal" skill that guides the agent through structured analysis → proposal generation
- Event listeners that capture proposals and route them through approval

**Key interfaces:**
```typescript
// Dexter's agent produces a stream of typed events
interface AgentEvent {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'done' | ...
}

// We add a new event type for trade proposals
interface TradeProposalEvent extends AgentEvent {
  type: 'trade_proposal'
  intent: TradeIntent
  reasoning: string
  research: ResearchSummary
}
```

### OpenBB (Data Layer)

OpenBB provides a unified Python API across 30+ data providers. We expose a subset of OpenBB's capabilities as Dexter tools.

**Integration approach:** Run OpenBB as a Python subprocess or HTTP service. Dexter tools call into it via a thin bridge.

Three options, in order of preference:

1. **MCP Server** — OpenBB ships an MCP server (`openbb-mcp`). If Dexter adds MCP client support, this is the cleanest path.
2. **REST API** — OpenBB ships a FastAPI server (`openbb-api`). Dexter tools can call HTTP endpoints.
3. **Python subprocess** — Call OpenBB Python SDK from a child process. Most coupling, least elegant, but works immediately.

**Tools we expose to Dexter:**

| Tool name | OpenBB command | Purpose |
|-----------|---------------|---------|
| `openbb_price_history` | `obb.equity.price.historical()` | OHLCV price data |
| `openbb_quote` | `obb.equity.price.quote()` | Current price and volume |
| `openbb_financials` | `obb.equity.fundamental.*` | Income, balance sheet, cash flow |
| `openbb_estimates` | `obb.equity.estimates.*` | Analyst estimates, price targets |
| `openbb_news` | `obb.news.world()` | Financial news |
| `openbb_technicals` | `obb.technical.*` | Moving averages, RSI, MACD |
| `openbb_screen` | `obb.equity.discovery.*` | Stock screening |
| `openbb_macro` | `obb.economy.*` | GDP, rates, inflation |

Each tool is a LangChain `StructuredTool` registered in Dexter's tool registry with rich descriptions so the agent knows when and how to use them.

### Human Approval Gate

Every trade proposal must pass through human approval before execution. This is not optional and cannot be bypassed programmatically.

**Approval flow:**
1. Dexter produces a `TradeIntent` with full reasoning
2. Safety wrapper validates against risk limits
3. CLI presents the proposal to the user with:
   - What: asset, direction, size, order type
   - Why: research summary and reasoning chain
   - Risk: position size relative to portfolio, stop loss, risk/reward
4. User chooses: `approve`, `reject`, `modify`, or `save` (for later)
5. Only `approve` triggers execution

**Risk limits (configurable):**
```yaml
safety:
  max_position_pct: 5.0        # max % of portfolio in one position
  max_order_value_usd: 1000    # max single order value
  allowed_assets: ["BTC", "ETH", "AAPL", "MSFT"]  # whitelist
  blocked_assets: []            # blacklist (overrides whitelist)
  require_stop_loss: true       # proposals must include stop loss
  require_reasoning: true       # proposals must include research summary
  paper_trading_only: true      # cannot be set to false in this project
```

### Hummingbot (Execution Layer)

Hummingbot provides exchange connectors with paper trading simulation. We use it exclusively in paper trade mode.

**Integration approach:** Hummingbot is a Python application. We run it as a separate process and communicate via its MQTT remote interface or a thin Python bridge.

**What we use:**
- `ConnectorManager.create_connector("binance_paper_trade", ["BTC-USDT"])` — paper trade connector
- `connector.buy()` / `connector.sell()` — order placement
- Event system — `OrderFilledEvent`, `OrderCancelledEvent`, etc.
- Balance tracking — simulated portfolio state

**Bridge design:**
```
Dexter (TypeScript)
  │
  │ approved TradeIntent (JSON over stdin/stdout or HTTP)
  │
  ▼
hummingbot_bridge.py (Python)
  │
  │ creates paper trade connector
  │ places order
  │ listens for events
  │ reports back
  │
  ▼
Hummingbot Core (Python/Cython)
```

The bridge is a thin Python script that:
1. Accepts a `TradeIntent` as JSON
2. Translates it to Hummingbot API calls
3. Places the order on a paper trade connector
4. Streams execution events back as JSON lines

### TradeIntent (Shared Data Format)

The `TradeIntent` is the structured format that flows through the entire pipeline. It is the contract between Dexter's research output and Hummingbot's execution input.

```typescript
interface TradeIntent {
  // Identity
  id: string                    // unique identifier
  timestamp: string             // ISO 8601
  
  // What
  asset: string                 // e.g., "AAPL", "BTC-USDT"
  direction: 'long' | 'short'
  order_type: 'market' | 'limit'
  limit_price?: number          // required if order_type is 'limit'
  quantity: number              // in base asset units
  
  // Risk management
  stop_loss?: number
  take_profit?: number
  time_horizon: string          // e.g., "1d", "1w", "1m"
  max_position_pct: number      // max % of portfolio
  
  // Reasoning (required)
  thesis: string                // one-paragraph investment thesis
  confidence: 'low' | 'medium' | 'high'
  key_factors: string[]         // bullet points supporting the thesis
  key_risks: string[]           // bullet points on what could go wrong
  research_ref: string          // reference to scratchpad entry
  
  // Lifecycle
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'filled' | 'cancelled'
  approved_by?: string          // "human" or future: specific user
  approved_at?: string
  execution_id?: string         // Hummingbot order ID
}
```

## Cross-language bridge

The primary challenge is that Dexter is TypeScript (Bun) while OpenBB and Hummingbot are Python. We handle this with a simple JSON-over-stdio protocol:

```
TypeScript (Dexter)  ←── JSON lines ───►  Python (OpenBB / Hummingbot)
```

Each bridge process:
- Reads JSON requests from stdin
- Writes JSON responses to stdout
- Writes logs to stderr
- One request-response per line (JSON Lines format)

This is intentionally simple. No gRPC, no message queues, no service mesh. If this prototype grows, the bridge can be replaced with something more robust.

## Data flow example

User asks: *"Should I buy AAPL right now?"*

1. **Dexter receives query**, plans research steps
2. **Dexter calls `openbb_quote`** → gets current AAPL price
3. **Dexter calls `openbb_financials`** → gets recent earnings, revenue
4. **Dexter calls `openbb_estimates`** → gets analyst price targets
5. **Dexter calls `openbb_technicals`** → gets RSI, moving averages
6. **Dexter calls `get_market_data`** (existing tool) → gets recent news
7. **Dexter synthesizes** → produces research summary
8. **Dexter generates `TradeIntent`** → structured buy proposal
9. **Safety wrapper validates** → checks position size, risk limits
10. **CLI presents to user** → shows proposal with full reasoning
11. **User approves** → intent status changes to `approved`
12. **Hummingbot bridge receives intent** → places paper trade order
13. **Hummingbot reports fill** → event logged, user notified

## Directory structure

```
dexter-openbb-hummingbot/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   ├── PLAN.md                  # phased implementation plan
│   └── TASKS.md                 # engineering tasks by phase
├── config/
│   └── example.env              # environment variable template
├── src/
│   ├── types/
│   │   └── trade-intent.ts      # TradeIntent interface definition
│   ├── tools/
│   │   └── openbb/              # OpenBB tool wrappers for Dexter
│   ├── bridge/
│   │   └── openbb_bridge.py     # Python bridge for OpenBB calls
│   │   └── hummingbot_bridge.py # Python bridge for Hummingbot
│   └── safety/
│       └── risk-limits.ts       # Safety wrapper and risk checks
└── scripts/
    └── ...                      # setup and utility scripts
```
