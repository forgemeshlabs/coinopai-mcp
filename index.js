#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { attachSponsored, FREE_TIER_TOOLS } = require("./ads.js");
const { createGuard } = require("./x402-guard");

const BASE_URL = "https://x402.coinopai.com";
// Highest listed price on this backend is $0.15; the guard refuses anything above it.
const guard = createGuard({
  baseUrl: BASE_URL,
  payTo: ["0x1304EC1A8945365e43A5c18a734065f107B417cA"],
  maxPriceUsd: 0.15,
  sessionBudgetUsd: 10,
});

const TOOLS = [
  {
    name: "search_agent_automations",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Search 819 agent automation prompts by keyword. Returns matching automations with title, description, complexity and services. Costs $0.01 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200, description: "Search keyword (e.g. 'slack', 'notion', 'github')" },
        limit: { type: "number", description: "Max results to return (default 20, max 50)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_agent_automation",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Get the full agent automation prompt and workflow steps by slug. Costs $0.01 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", maxLength: 200, pattern: "^[A-Za-z0-9._-]+$", description: "Automation slug (e.g. 'slack-to-notion')" }
      },
      required: ["slug"]
    }
  },
  {
    name: "list_automation_categories",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "List all 35 automation categories with counts. Costs $0.005 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signals",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Latest Kronos model context for BTC, ETH, SOL, XRP, ADA. Directional values are supporting context, not standalone trade instructions; use them with the calibrated range, risk state, and audit record. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
      }
    }
  },
  {
    name: "get_crypto_risk",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Current market risk state and cooldown context for Kronos decisions. Useful as supporting context, not a standalone trading command. Costs $0.02 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signal_history",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Recent Kronos context history for BTC/ETH/SOL/XRP/ADA. Use it to inspect model context and freshness before or after a decision. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours of history to fetch (default 24, max 168)" }
      }
    }
  },
  {
    name: "get_crypto_decision",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Create a market-intelligence journal entry from Kronos context. Returns directional_bias, confidence context, compliance metadata, regime, anomaly/calibration context, and a decision_id. Call audit_trade_decision with that ID after the evaluation window to see what happened. Costs $0.15 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to evaluate: BTC, ETH, SOL, XRP, or ADA" }
      },
      required: ["symbol"]
    }
  },
  {
    name: "check_trade_preflight",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Step 1 of the auditable decision loop. Checks market state, cooldown, data freshness, and model context before calling get_crypto_decision. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to check: BTC, ETH, SOL, XRP, or ADA" }
      },
      required: ["symbol"]
    }
  },
  {
    name: "audit_trade_decision",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "The accountability step. Verify a Kronos decision_id against later market prices. Returns whether direction held, PnL%, and a verdict: GOOD_DECISION, BAD_DIRECTION, NOISE, or NO_ACTION_TAKEN. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "UUID from a previous get_crypto_decision call" },
        window: { type: "string", description: "Evaluation window: 1h, 4h, or 24h (default: 4h)" }
      },
      required: ["decision_id"]
    }
  },
  {
    name: "get_futures_decision",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Kronos Futures: perpetual-futures decision package. Direction LONG / SHORT / FLAT from the Kronos signal, stop-loss and take-profit on the calibrated 80% range, leverage cap keeping liquidation outside 2x the stop, liquidation price, risk-based position size for your equity, and live perp funding cost. Market intelligence only; no exchange execution. Costs $0.15 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol: BTC, ETH, SOL, XRP, ADA (default: BTC)" },
        equity: { type: "number", description: "Account equity in USD for position sizing (optional)" },
        max_loss_pct: { type: "number", description: "Max loss per position as a fraction of equity (default 0.01)" },
        max_leverage: { type: "number", description: "Your leverage ceiling, 1-5 (default 5)" }
      }
    }
  },
  {
    name: "get_perp_funding",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Kronos Futures: live perpetual funding rates (1h, 8h, annualized), mark/index price, open interest, and crowding label (LONG_CROWDED / SHORT_CROWDED / BALANCED) for BTC, ETH, SOL, XRP, ADA from Kraken Futures and Hyperliquid. Costs $0.02 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Optional single symbol; omit for all five" }
      }
    }
  },
  {
    name: "check_futures_risk",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Kronos Futures: will a leveraged perp position survive the calibrated range? Returns liquidation price and distance, adverse range bound, verdict (SURVIVES_RANGE / THIN_BUFFER / LIQUIDATION_INSIDE_RANGE), max surviving leverage, P&L at both range bounds, and funding cost. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol: BTC, ETH, SOL, XRP, ADA (default: BTC)" },
        side: { type: "string", description: "LONG or SHORT" },
        leverage: { type: "number", description: "Leverage to test (1-125)" },
        entry: { type: "number", description: "Entry price (defaults to current perp mark)" },
        notional: { type: "number", description: "Position notional in USD for funding cost (optional)" },
        horizon_hours: { type: "number", description: "Hours held for funding cost (optional)" }
      },
      required: ["side", "leverage"]
    }
  },
  {
    name: "get_crypto_forecast",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Conformally-calibrated price forecast: an honest 80% prediction interval (range_80, ~0.80 empirical coverage) plus point return and upside probability for BTC/ETH/SOL/XRP/ADA. Directional bias is supporting context; the calibrated range is the validated product. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol: BTC, ETH, SOL, XRP, ADA (default: BTC)" }
      }
    }
  },
  {
    name: "list_tools",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description: "Free. Lists every CoinOpAI tool with its price, so an agent can pick before paying.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "review_signal_anomaly",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Score a market signal feature set for unusual conditions before downstream analysis. Returns anomaly_score, anomaly_level, review_label, drivers, component scores, and market-intelligence disclaimers. Not financial advice and not a market activity instruction. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to review, e.g. BTC, ETH, SOL, XRP, ADA, AAPL, SPY" },
        window: { type: "string", description: "Observation window label, e.g. 24h (default: 24h)" },
        features: {
          type: "object",
          description: "Numeric feature values to score, such as price_change, volume_change, volatility, signal_confidence, risk_score, social_velocity, or onchain_velocity."
        }
      },
      required: ["symbol", "features"]
    }
  }
];

function buildHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY required — set a Base wallet private key with USDC funded");
  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))).registerPolicy(guard.policy);
  return new x402HTTPClient(coreClient);
}

// Argument validation — runs before any network call or wallet access.
const SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "ADA"];
function str(v, name, { max = 200, pattern } = {}) {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw new Error(`${name} must be a non-empty string of at most ${max} characters`);
  if (pattern && !pattern.test(v)) throw new Error(`${name} has an invalid format`);
  return v;
}
function num(v, name, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return v;
}
function optNum(v, name, min, max) { return v === undefined || v === null ? undefined : num(v, name, min, max); }
function symbol(v, dflt) {
  if (v === undefined || v === null) return dflt;
  const up = str(v, "symbol", { max: 10 }).toUpperCase();
  if (!SYMBOLS.includes(up)) throw new Error(`symbol must be one of ${SYMBOLS.join(", ")}`);
  return up;
}

async function main() {
  let httpClient;
  function getHttpClient() {
    if (!httpClient) httpClient = buildHttpClient();
    return httpClient;
  }

  const server = new Server(
    { name: "coinopai-mcp", version: require("./package.json").version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = req.params.arguments || {};
    try {
      let data;
      switch (name) {
        case "list_tools": {
          // Free: plain bounded fetch, no wallet
          const r = await guard.fetchBounded("/menu");
          if (!r.ok) throw new Error(`/menu returned ${r.status}`);
          try { data = JSON.parse(r.text); } catch (e) { throw new Error("/menu returned non-JSON: " + e.message); }
          break;
        }
        case "search_agent_automations": {
          const query = { q: str(args.query, "query", { max: 200 }), limit: args.limit === undefined ? 20 : num(args.limit, "limit", 1, 50) };
          data = await guard.callPaid(getHttpClient(), "/api/search", { query });
          break;
        }
        case "get_agent_automation":
          data = await guard.callPaid(getHttpClient(), `/api/automation/${encodeURIComponent(str(args.slug, "slug", { max: 200, pattern: /^[A-Za-z0-9._-]+$/ }))}`);
          break;
        case "list_automation_categories":
          data = await guard.callPaid(getHttpClient(), "/api/categories");
          break;
        case "get_crypto_risk":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/risk");
          break;
        case "get_crypto_signals":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/signals");
          break;
        case "get_crypto_signal_history":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/history", { query: { hours: args.hours === undefined ? 24 : num(args.hours, "hours", 1, 168) } });
          break;
        case "get_crypto_decision":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/decision", { query: { symbol: symbol(args.symbol, "BTC") } });
          break;
        case "check_trade_preflight":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/preflight", { query: { symbol: symbol(args.symbol, "BTC") } });
          break;
        case "audit_trade_decision": {
          const decisionId = str(args.decision_id, "decision_id", { max: 64, pattern: /^[A-Za-z0-9-]+$/ });
          const windowArg = args.window === undefined ? "4h" : args.window;
          if (!["1h", "4h", "24h"].includes(windowArg)) throw new Error("window must be one of 1h, 4h, 24h");
          data = await guard.callPaid(getHttpClient(), "/api/kronos/audit", { query: { decision_id: decisionId, window: windowArg } });
          break;
        }
        case "get_crypto_forecast":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/forecast", { query: { symbol: symbol(args.symbol, "BTC") } });
          break;
        case "get_futures_decision":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/futures/decision", { query: {
            symbol: symbol(args.symbol, "BTC"),
            equity: optNum(args.equity, "equity", 0, 1e12),
            max_loss_pct: optNum(args.max_loss_pct, "max_loss_pct", 0, 1),
            max_leverage: optNum(args.max_leverage, "max_leverage", 1, 5),
          } });
          break;
        case "get_perp_funding":
          data = await guard.callPaid(getHttpClient(), "/api/kronos/futures/funding", { query: { symbol: args.symbol === undefined ? undefined : symbol(args.symbol) } });
          break;
        case "check_futures_risk": {
          const side = typeof args.side === "string" ? args.side.toUpperCase() : "";
          if (side !== "LONG" && side !== "SHORT") throw new Error("side must be LONG or SHORT");
          data = await guard.callPaid(getHttpClient(), "/api/kronos/futures/risk", { query: {
            symbol: symbol(args.symbol, "BTC"),
            side,
            leverage: num(args.leverage, "leverage", 1, 125),
            entry: optNum(args.entry, "entry", 0, 1e12),
            notional: optNum(args.notional, "notional", 0, 1e12),
            horizon_hours: optNum(args.horizon_hours, "horizon_hours", 0, 1e5),
          } });
          break;
        }
        case "review_signal_anomaly": {
          if (!args.features || typeof args.features !== "object" || Array.isArray(args.features)) throw new Error("features must be an object of numeric feature values");
          if (JSON.stringify(args.features).length > 4000) throw new Error("features is too large");
          data = await guard.callPaid(getHttpClient(), "/api/anomaly", {
            method: "POST",
            body: {
              symbol: str(args.symbol, "symbol", { max: 20, pattern: /^[A-Za-z0-9._-]+$/ }),
              window: args.window === undefined ? "24h" : str(args.window, "window", { max: 20, pattern: /^[A-Za-z0-9]+$/ }),
              features: args.features,
            },
          });
          break;
        }
        default:
          throw new Error("Unknown tool: " + name);
      }
      // Sponsored card (Lulu Ads) — free-tier tools only, skipped when the
      // response settled an x402 payment. Paid tools never reach this call.
      if (FREE_TIER_TOOLS.has(name)) data = await attachSponsored(name, data);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "Error: " + e.message }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}

main();
