#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");

const BASE_URL = "https://x402.coinopai.com";

const TOOLS = [
  {
    name: "search_agent_automations",
    description: "Search 819 agent automation prompts by keyword. Returns matching automations with title, description, complexity and services. Costs $0.01 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword (e.g. 'slack', 'notion', 'github')" },
        limit: { type: "number", description: "Max results to return (default 20, max 50)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_agent_automation",
    description: "Get the full agent automation prompt and workflow steps by slug. Costs $0.01 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Automation slug (e.g. 'slack-to-notion')" }
      },
      required: ["slug"]
    }
  },
  {
    name: "list_automation_categories",
    description: "List all 35 automation categories with counts. Costs $0.005 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signals",
    description: "Latest hourly directional signals for BTC, ETH, SOL, XRP, ADA from the Kronos model. Positive = bullish, negative = bearish. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_risk",
    description: "Current crypto market risk state (NORMAL/ELEVATED/HIGH), regime detection, equity tracking, signal streaks. Costs $0.02 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signal_history",
    description: "Historical 15-minute crypto signals from Kronos — up to 168 hours of BTC/ETH/SOL/XRP/ADA data. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours of history to fetch (default 24, max 168)" }
      }
    }
  },
  {
    name: "get_crypto_decision",
    description: "Get a probabilistic trade decision from Kronos — then verify it. Returns CONSIDER_LONG/SHORT/NO_ACTION with confidence, regime, and a decision_id. Call audit_trade_decision with that ID after 1h to see if the decision was right. Full loop: preflight ($0.05) → decision ($0.15) → audit ($0.07) = $0.27 per verified cycle. Costs $0.15 USDC.",
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
    description: "Step 1 of the trade loop — checks if conditions allow a trade. Returns allowed:true/false, market state, cooldown, signal strength, warnings. If allowed, proceed to get_crypto_decision. Costs $0.05 USDC.",
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
    description: "The accountability step — verify any decision against real prices. Pass the decision_id from get_crypto_decision and a window (1h/4h/24h). Returns: did the direction hold? What was the PnL%? Verdict: GOOD_DECISION, BAD_DIRECTION, or NOISE. Every decision should be audited. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "UUID from a previous get_crypto_decision call" },
        window: { type: "string", description: "Evaluation window: 1h, 4h, or 24h (default: 4h)" }
      },
      required: ["decision_id"]
    }
  }
];

function buildHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY required — set a Base wallet private key with USDC funded");

  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const signer = toClientEvmSigner(account);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(signer));
  return new x402HTTPClient(coreClient);
}

async function call(httpClient, path) {
  const url = BASE_URL + path;
  const res = await fetch(url);

  if (res.status === 402) {
    let body;
    try { body = await res.clone().json(); } catch (_) {}
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => res.headers.get(name),
      body
    );
    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const paidRes = await fetch(url, {
      headers: httpClient.encodePaymentSignatureHeader(paymentPayload),
    });
    if (!paidRes.ok) {
      const errBody = await paidRes.text().catch(() => paidRes.statusText);
      throw new Error(`HTTP ${paidRes.status}: ${errBody.slice(0, 200)}`);
    }
    return paidRes.json();
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  let httpClient;
  try {
    httpClient = buildHttpClient();
  } catch (e) {
    process.stderr.write("[coinopai-mcp] " + e.message + "\n");
    process.exit(1);
  }

  const server = new Server(
    { name: "coinopai-mcp", version: "1.0.4" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      let data;
      switch (name) {
        case "search_agent_automations":
          data = await call(httpClient, `/api/search?q=${encodeURIComponent(args.query || "")}&limit=${args.limit || 20}`);
          break;
        case "get_agent_automation":
          data = await call(httpClient, `/api/automation/${encodeURIComponent(args.slug)}`);
          break;
        case "list_automation_categories":
          data = await call(httpClient, "/api/categories");
          break;
        case "get_crypto_signals":
          data = await call(httpClient, "/api/kronos/signals");
          break;
        case "get_crypto_risk":
          data = await call(httpClient, "/api/kronos/risk");
          break;
        case "get_crypto_signal_history":
          data = await call(httpClient, `/api/kronos/history?hours=${args.hours || 24}`);
          break;
        case "get_crypto_decision":
          data = await call(httpClient, `/api/kronos/decision?symbol=${encodeURIComponent(args.symbol || "BTC")}`);
          break;
        case "check_trade_preflight":
          data = await call(httpClient, `/api/kronos/preflight?symbol=${encodeURIComponent(args.symbol || "BTC")}`);
          break;
        case "audit_trade_decision":
          data = await call(httpClient, `/api/kronos/audit?decision_id=${encodeURIComponent(args.decision_id)}&window=${encodeURIComponent(args.window || "4h")}`);
          break;
        default:
          throw new Error("Unknown tool: " + name);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "Error: " + e.message }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
