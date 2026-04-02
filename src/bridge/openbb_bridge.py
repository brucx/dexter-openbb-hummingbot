"""
OpenBB Bridge — JSON Lines stdin/stdout bridge for Dexter ↔ OpenBB communication.

Reads JSON requests from stdin, calls OpenBB, writes JSON responses to stdout.
Logs go to stderr so they don't interfere with the protocol.

Supports three mode settings via OPENBB_BRIDGE_MODE env var:

  auto     (default) — try to import openbb; use LIVE if available, FALLBACK otherwise
  live     — require openbb SDK; exit with error if not installed
  fallback — force deterministic sample data (no dependencies needed)

The bridge auto-detects which mode to use when OPENBB_BRIDGE_MODE is unset or "auto".
"""

import json
import sys
import os
import logging
from datetime import datetime, timedelta, timezone

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[openbb-bridge] %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mode detection
# ---------------------------------------------------------------------------
OPENBB_AVAILABLE = False
obb = None

# ---------------------------------------------------------------------------
# Credential env-var normalization
# ---------------------------------------------------------------------------
# OpenBB expects specific env var names (e.g. TIINGO_TOKEN, not TIINGO_API_KEY).
# Map common user-facing names to what OpenBB actually reads so credentials
# "just work" regardless of which name the user sets.
_ENV_ALIASES = {
    "TIINGO_API_KEY": "TIINGO_TOKEN",
    "BENZINGA_API_KEY": "BENZINGA_API_KEY",      # same name, no-op
    "FMP_API_KEY": "FMP_API_KEY",                # same name, no-op
    "INTRINIO_API_KEY": "INTRINIO_API_KEY",      # same name, no-op
}

for _src, _dst in _ENV_ALIASES.items():
    if _src != _dst and os.environ.get(_src) and not os.environ.get(_dst):
        os.environ[_dst] = os.environ[_src]
        log.info(f"Mapped {_src} → {_dst} for OpenBB credential loading")

_mode = os.environ.get("OPENBB_BRIDGE_MODE", "auto").lower()

if _mode == "fallback":
    log.info("OPENBB_BRIDGE_MODE=fallback — running in FALLBACK mode")
elif _mode in ("auto", "live"):
    try:
        from openbb import obb as _obb  # type: ignore
        obb = _obb
        OPENBB_AVAILABLE = True
        log.info("OpenBB SDK loaded — running in LIVE mode")
    except ImportError:
        if _mode == "live":
            log.error("OPENBB_BRIDGE_MODE=live but OpenBB SDK is not installed. "
                      "Install with: pip install openbb")
            sys.exit(1)
        log.info("OpenBB SDK not found — running in FALLBACK mode (deterministic sample data)")
else:
    log.warning(f"Unknown OPENBB_BRIDGE_MODE={_mode!r}, treating as 'auto'")
    try:
        from openbb import obb as _obb  # type: ignore
        obb = _obb
        OPENBB_AVAILABLE = True
        log.info("OpenBB SDK loaded — running in LIVE mode")
    except ImportError:
        log.info("OpenBB SDK not found — running in FALLBACK mode (deterministic sample data)")


# ---------------------------------------------------------------------------
# FALLBACK data generators — deterministic, clearly marked as sample data
# ---------------------------------------------------------------------------

def _fallback_quote(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    return {
        "_fallback": True,
        "_note": "Deterministic sample data — OpenBB SDK not available",
        "symbol": symbol,
        "name": f"{symbol} Inc.",
        "price": 185.50,
        "change": 2.35,
        "change_percent": 1.28,
        "volume": 54_321_000,
        "market_cap": 2_870_000_000_000,
        "pe_ratio": 30.5,
        "52_week_high": 199.62,
        "52_week_low": 143.90,
        "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
    }


def _fallback_price_history(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    days = params.get("days", 30)
    days = min(int(days), 90)
    base_price = 180.0
    today = datetime.now(timezone.utc).date()
    records = []
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        # deterministic price walk
        offset = (i * 7 + 3) % 20 - 10  # oscillates -10..+9
        price = round(base_price + offset * 0.5, 2)
        records.append({
            "date": d.isoformat(),
            "open": price,
            "high": round(price + 1.5, 2),
            "low": round(price - 1.2, 2),
            "close": round(price + 0.3, 2),
            "volume": 50_000_000 + i * 100_000,
        })
    return {
        "_fallback": True,
        "_note": "Deterministic sample data — OpenBB SDK not available",
        "symbol": symbol,
        "records": records,
    }


def _fallback_financials(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    return {
        "_fallback": True,
        "_note": "Deterministic sample data — OpenBB SDK not available",
        "symbol": symbol,
        "period": params.get("period", "annual"),
        "income_statement": {
            "revenue": 394_328_000_000,
            "gross_profit": 170_782_000_000,
            "operating_income": 114_301_000_000,
            "net_income": 96_995_000_000,
            "eps": 6.13,
        },
        "balance_sheet": {
            "total_assets": 352_583_000_000,
            "total_liabilities": 290_437_000_000,
            "total_equity": 62_146_000_000,
        },
    }


def _fallback_news(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    return {
        "_fallback": True,
        "_note": "Deterministic sample data — OpenBB SDK not available",
        "symbol": symbol,
        "articles": [
            {
                "title": f"{symbol} Reports Strong Quarterly Earnings",
                "source": "Sample Financial News",
                "date": datetime.now(timezone.utc).isoformat() + "Z",
                "summary": f"Sample article about {symbol} earnings performance.",
                "url": "https://example.com/sample-article-1",
            },
            {
                "title": f"Analysts Raise {symbol} Price Target",
                "source": "Sample Market Watch",
                "date": datetime.now(timezone.utc).isoformat() + "Z",
                "summary": f"Sample article about analyst coverage of {symbol}.",
                "url": "https://example.com/sample-article-2",
            },
        ],
    }


# ---------------------------------------------------------------------------
# LIVE OpenBB handlers
# ---------------------------------------------------------------------------

def _live_quote(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    result = obb.equity.price.quote(symbol=symbol)  # type: ignore
    df = result.to_df()
    if df.empty:
        return {"symbol": symbol, "error": "No data returned"}
    row = df.iloc[0].to_dict()
    # Convert any non-serializable types
    return {k: _make_serializable(v) for k, v in row.items()}


def _live_price_history(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    days = int(params.get("days", 30))
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    result = obb.equity.price.historical(symbol=symbol, start_date=start)  # type: ignore
    df = result.to_df()
    records = []
    for _, row in df.iterrows():
        records.append({k: _make_serializable(v) for k, v in row.to_dict().items()})
    return {"symbol": symbol, "records": records, "provider": getattr(result, "provider", None)}


def _live_financials(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    period = params.get("period", "annual")
    result = obb.equity.fundamental.income(symbol=symbol, period=period)  # type: ignore
    df = result.to_df()
    records = []
    for _, row in df.iterrows():
        records.append({k: _make_serializable(v) for k, v in row.to_dict().items()})
    return {"symbol": symbol, "period": period, "income_statement": records}


def _live_news(params: dict) -> dict:
    symbol = params.get("symbol", "AAPL")
    limit = int(params.get("limit", 5))
    # obb.news.company supports yfinance (free, no key) while obb.news.world
    # only supports benzinga/fmp/intrinio/tiingo (all require API keys).
    # Try company news first; fall back to world news if a paid provider is
    # configured (world news gives broader coverage when credentials exist).
    result = None
    try:
        result = obb.news.company(symbol=symbol, limit=limit)  # type: ignore
    except Exception:
        # company news failed — try world news (requires paid provider creds)
        result = obb.news.world(query=symbol, limit=limit)  # type: ignore
    df = result.to_df()
    articles = []
    for _, row in df.iterrows():
        articles.append({k: _make_serializable(v) for k, v in row.to_dict().items()})
    return {"symbol": symbol, "articles": articles}


def _make_serializable(v):
    """Convert numpy/pandas types to JSON-safe Python types."""
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    if hasattr(v, "isoformat"):  # datetime
        return v.isoformat()
    if v != v:  # NaN check
        return None
    return v


# ---------------------------------------------------------------------------
# Handler dispatch table
# ---------------------------------------------------------------------------

if OPENBB_AVAILABLE:
    HANDLERS = {
        "quote": _live_quote,
        "price_history": _live_price_history,
        "financials": _live_financials,
        "news": _live_news,
    }
else:
    HANDLERS = {
        "quote": _fallback_quote,
        "price_history": _fallback_price_history,
        "financials": _fallback_financials,
        "news": _fallback_news,
    }


# Stubs for methods not yet implemented
UNIMPLEMENTED = {"technicals", "estimates", "screen", "macro"}


def handle_request(request: dict) -> dict:
    """Dispatch a request to the appropriate handler."""
    req_id = request.get("id", "unknown")
    method = request.get("method")
    params = request.get("params", {})

    if method in UNIMPLEMENTED:
        return {
            "id": req_id,
            "error": None,
            "data": {
                "_stub": True,
                "_note": f"Method '{method}' is not yet implemented (Phase 1 scope: quote, price_history, financials, news)",
                "method": method,
                "params": params,
            },
        }

    if method not in HANDLERS:
        return {
            "id": req_id,
            "error": f"Unknown method: {method}",
            "data": None,
        }

    try:
        data = HANDLERS[method](params)
        return {"id": req_id, "error": None, "data": data, "provider": "openbb" if OPENBB_AVAILABLE else "fallback"}
    except Exception as e:
        log.error(f"Error handling {method}: {e}")
        return {"id": req_id, "error": str(e), "data": None}


def main():
    """Main loop: read JSON Lines from stdin, write responses to stdout."""
    mode = "LIVE" if OPENBB_AVAILABLE else "FALLBACK"
    log.info(f"OpenBB bridge ready ({mode} mode). Supported methods: {sorted(HANDLERS.keys())}")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(
                json.dumps({"id": "unknown", "error": f"Invalid JSON: {e}", "data": None})
                + "\n"
            )
            sys.stdout.flush()
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
