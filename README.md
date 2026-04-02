# dexter-openbb-hummingbot

An integration architecture connecting [Dexter](https://github.com/virattt/dexter) (AI research agent), [OpenBB](https://github.com/OpenBB-finance/OpenBB) (market data platform), and [Hummingbot](https://github.com/hummingbot/hummingbot) (trading execution framework) into a coherent research-to-execution pipeline with human oversight at every stage.

## Vision

Most AI trading projects skip straight to autonomous execution. This project takes a different approach: build a **research-first pipeline** where an AI agent can analyze markets deeply, propose trade ideas with full reasoning, and — only with explicit human approval — execute them in a paper trading environment.

The goal is not to build an autonomous trading bot. It is to build a **human-augmented research and execution workflow** where the AI does the heavy lifting on analysis and the human retains full control over capital decisions.

## How the pieces fit together

```
┌─────────────────────────────────────────────────────────┐
│  Dexter (Orchestration + Research Agent)                │
│  - Decomposes research questions into multi-step plans  │
│  - Calls tools, synthesizes findings, proposes actions  │
│  - Generates structured TradeIntent proposals           │
├─────────────────────────────────────────────────────────┤
│  OpenBB (Market Data + Research Tools)                  │
│  - Unified API across 30+ data providers                │
│  - Equity, crypto, macro, options, news                 │
│  - Technical analysis, quantitative tools               │
├─────────────────────────────────────────────────────────┤
│  Human Approval Gate                                    │
│  - Reviews trade proposals with full reasoning chain    │
│  - Approves, rejects, or modifies before execution      │
│  - Configurable risk limits and position constraints     │
├─────────────────────────────────────────────────────────┤
│  Hummingbot (Execution Layer — Paper Trading Only)      │
│  - Paper trade connectors with real market data          │
│  - Order placement, tracking, and event reporting        │
│  - Position and balance management                       │
└─────────────────────────────────────────────────────────┘
```

## Scope

**In scope:**
- Dexter as the AI research agent, using its existing LangChain-based agent loop
- OpenBB as a tool provider for market data, fundamentals, and analysis
- Hummingbot paper trading connectors for simulated execution
- A human approval layer between research output and trade execution
- Structured trade intent format for machine-readable proposals
- CLI-based workflow for the initial implementation

**Out of scope (and staying that way):**
- Autonomous real-money trading
- High-frequency or latency-sensitive strategies
- Portfolio management or rebalancing automation
- Social trading, copy trading, or multi-user features
- Mobile or web UI (CLI first, always)

## Non-goals

This project will **not**:
- Execute trades without explicit human approval
- Connect to live exchange accounts with real funds
- Attempt to "beat the market" or promise returns
- Replace human judgment with AI judgment on capital allocation
- Become a product — this is a prototype and learning tool

## Project status

**Phase 1 complete. Phase 2 core complete.** The full research-to-proposal pipeline works end-to-end, including persistence and CLI formatting.

See [docs/PLAN.md](docs/PLAN.md) for the full roadmap and [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for current status.

### What works now (end-to-end)

- **OpenBB bridge** (`src/bridge/openbb_bridge.py`) — JSON Lines stdin/stdout protocol with 4 methods: `quote`, `price_history`, `financials`, `news`. Auto-detects OpenBB SDK; falls back to deterministic sample data if not installed.
- **Bridge client** (`src/bridge/bridge-client.ts`) — TypeScript process manager with request/response correlation, timeouts, and diagnostics.
- **Research service** (`src/services/research.ts`) — High-level API: `getQuote()`, `getPriceHistory()`, `getFinancials()`, `getNews()`, and `research()` (parallel snapshot). All responses normalized into typed interfaces.
- **Proposal builder** (`src/services/proposal.ts`) — `buildProposal()` validates and shapes research + parameters into a TradeIntent. `autoDraftProposal()` for quick demos.
- **Proposal persistence** (`src/services/persistence.ts`) — Save, load, and list proposals as JSON files in `data/proposals/`.
- **CLI formatting** (`src/services/format.ts`) — `formatProposal()` for rich terminal display, `formatProposalList()` for summary tables.
- **Tests** — 70 tests across 3 suites: unit, integration, and persistence/format. Run with `npm run test:all`.

### What remains stubbed

- **OpenBB methods**: `technicals`, `estimates`, `screen`, `macro` return stub responses.
- **LangChain tool wrappers**: The research service is ready but not yet wrapped as LangChain StructuredTools.
- **Hummingbot bridge**: Placeholder only (Phase 3).
- **Human approval gate**: Not yet built (Phase 3).
- **Safety engine**: Types and basic checks exist; full integration pending (Phase 4).

## Getting started

Prerequisites:
- Node.js 18+ (with npm)
- Python 3.10+
- (Optional) `pip install openbb` for live market data — works without it using fallback data

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Run all tests (unit + integration + persistence/format)
npm run test:all

# Run the research demo (auto mode: uses live OpenBB if installed, falls back to sample data)
npm run demo

# Force live mode (requires OpenBB SDK — fails if not installed)
npm run demo:live

# Force fallback mode (deterministic sample data, no dependencies)
npm run demo:fallback

# Run with a different symbol
npx tsx examples/research-demo.ts MSFT

# Run the low-level bridge protocol test
npm run demo:bridge

# Use a repo-local virtualenv for live mode
OPENBB_PYTHON_BIN=.venv-openbb/bin/python3 npm run demo:live
```

### Bridge modes

The OpenBB bridge supports three modes, controlled by the `OPENBB_BRIDGE_MODE` environment variable:

| Mode | Env value | Behavior |
|------|-----------|----------|
| **Auto** (default) | `auto` or unset | Tries to import OpenBB SDK; uses live data if available, otherwise falls back to sample data |
| **Live** | `live` | Requires OpenBB SDK; exits with error if not installed |
| **Fallback** | `fallback` | Always uses deterministic sample data — no external dependencies needed |

### Python interpreter

By default the bridge spawns `python3`. If OpenBB is installed in a virtualenv (common), set `OPENBB_PYTHON_BIN` to point at the correct interpreter:

```bash
# Repo-local virtualenv
export OPENBB_PYTHON_BIN=.venv-openbb/bin/python3

# Or use an absolute path
export OPENBB_PYTHON_BIN=/home/user/envs/openbb/bin/python3
```

This is respected by `ResearchService`, both demo scripts, and the npm `demo:live` script.

**Prerequisites for live mode:**
- Python 3.10+
- `pip install openbb` (and any provider extensions you need, e.g. `openbb[yfinance]`)
- The `OPENBB_PYTHON_BIN` env var pointing at the interpreter where OpenBB is installed (if not the system `python3`)
- API keys configured per OpenBB docs (some providers like Yahoo Finance work without keys)

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and integration points
- [Implementation Plan](docs/PLAN.md) — Phased roadmap
- [Engineering Tasks](docs/TASKS.md) — Concrete work items by phase

## License

MIT
