#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, createWalletClient, http, parseAbi } = require("viem");
const { base } = require("viem/chains");

const BASE_URL = "https://x402.coinopai.com";

// Pyrimid constants — on-chain addresses for affiliate payment routing
const PYRIMID_ROUTER = "0xc949AEa380D7b7984806143ddbfE519B03ABd68B";
const PYRIMID_VENDOR_ID = "0x034604e25078e293d7b181fa23b3f2f6";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER_ABI = parseAbi([
  "function routePayment(bytes16 vendorId, uint256 productId, bytes16 affiliateId, address buyer, uint256 maxPrice) external",
]);
const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);
// Paths with registered Pyrimid product IDs — other paths fall back to standard x402
const PYRIMID_PRODUCTS = {
  "/api/kronos/signals":   { productId: 1n, priceUsdc:  50000n },
  "/api/kronos/decision":  { productId: 2n, priceUsdc: 150000n },
  "/api/kronos/preflight": { productId: 4n, priceUsdc:  50000n },
  "/api/kronos/audit":     { productId: 5n, priceUsdc:  70000n },
  "/api/kronos/risk":      { productId: 6n, priceUsdc:  20000n },
  "/api/kronos/history":   { productId: 7n, priceUsdc:  50000n },
};
const IMAGEGEN_URL = "https://imagegen.coinopai.com";
const PYRIMID_PRODUCTS_IMAGEGEN = {
  "/generate": { productId: 3n, priceUsdc: 100000n },
};
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

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
    description: "Latest Kronos model context for BTC, ETH, SOL, XRP, ADA. Directional values are supporting context, not standalone trade instructions; use them with the calibrated range, risk state, and audit record. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      }
    }
  },
  {
    name: "get_crypto_risk",
    description: "Current market risk state and cooldown context for Kronos decisions. Useful as supporting context, not a standalone trading command. Costs $0.02 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signal_history",
    description: "Recent Kronos context history for BTC/ETH/SOL/XRP/ADA. Use it to inspect model context and freshness before or after a decision. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours of history to fetch (default 24, max 168)" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      }
    }
  },
  {
    name: "get_crypto_decision",
    description: "Create a market-intelligence journal entry from Kronos context. Returns directional_bias, confidence context, compliance metadata, regime, anomaly/calibration context, and a decision_id. Call audit_trade_decision with that ID after the evaluation window to see what happened. Costs $0.15 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to evaluate: BTC, ETH, SOL, XRP, or ADA" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      },
      required: ["symbol"]
    }
  },
  {
    name: "check_trade_preflight",
    description: "Step 1 of the auditable decision loop. Checks market state, cooldown, data freshness, and model context before calling get_crypto_decision. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to check: BTC, ETH, SOL, XRP, or ADA" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      },
      required: ["symbol"]
    }
  },
  {
    name: "audit_trade_decision",
    description: "The accountability step. Verify a Kronos decision_id against later market prices. Returns whether direction held, PnL%, and a verdict: GOOD_DECISION, BAD_DIRECTION, NOISE, or NO_ACTION_TAKEN. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "UUID from a previous get_crypto_decision call" },
        window: { type: "string", description: "Evaluation window: 1h, 4h, or 24h (default: 4h)" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      },
      required: ["decision_id"]
    }
  },
  {
    name: "get_crypto_forecast",
    description: "Conformally-calibrated price forecast: an honest 80% prediction interval (range_80, ~0.80 empirical coverage) plus point return and upside probability for BTC/ETH/SOL/XRP/ADA. Directional bias is supporting context; the calibrated range is the validated product. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol: BTC, ETH, SOL, XRP, ADA (default: BTC)" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      }
    }
  },
  {
    name: "review_signal_anomaly",
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
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
  return { httpClient: new x402HTTPClient(coreClient), account };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function createChainTimedPaymentPayload(httpClient, paymentRequired) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });
    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const originalNow = Date.now;
    const localNow = Math.floor(originalNow() / 1000);
    const timeout = Number(paymentRequired.accepts?.[0]?.maxTimeoutSeconds || 300);
    const lowerBound = localNow + 30 - timeout;
    const upperBound = chainNow + 600;
    const signingNow = Math.min(Math.max(chainNow, lowerBound), upperBound);
    // x402 derives EIP-3009 validity windows from Date.now; choose a timestamp valid for both Base block time and facilitator wall-clock checks.
    Date.now = () => signingNow * 1000;
    try {
      return await httpClient.createPaymentPayload(paymentRequired);
    } finally {
      Date.now = originalNow;
    }
  } catch (_) {
    return httpClient.createPaymentPayload(paymentRequired);
  }
}

// Pyrimid affiliate flow — approve + routePayment on-chain, then retry with tx hash
async function callPyrimid(account, path, affiliateId, baseUrl, products) {
  const pathname = new URL(path, baseUrl).pathname;
  const product = products[pathname];
  if (!product) throw new Error(`No Pyrimid product registered for ${pathname}`);
  const url = baseUrl + path;
  const transport = http(BASE_RPC_URL);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  const approveHash = await walletClient.writeContract({
    address: USDC_ADDRESS, abi: USDC_ABI,
    functionName: "approve", args: [PYRIMID_ROUTER, product.priceUsdc],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  await sleep(3000);

  const routeHash = await walletClient.writeContract({
    address: PYRIMID_ROUTER, abi: ROUTER_ABI,
    functionName: "routePayment",
    args: [PYRIMID_VENDOR_ID, product.productId, "0x00000000000000000000000000000000", account.address, product.priceUsdc],
  });
  await publicClient.waitForTransactionReceipt({ hash: routeHash });
  await sleep(3000);

  const paidRes = await fetch(url, { headers: { "X-Affiliate-ID": affiliateId, "X-Payment": routeHash } });
  if (!paidRes.ok) {
    const err = await paidRes.text().catch(() => paidRes.statusText);
    throw new Error(`Pyrimid retry failed: ${paidRes.status} ${err.slice(0, 200)}`);
  }
  return paidRes.json();
}

async function callPaid(ctx, path, affiliateId, opts = {}) {
  const { httpClient, account } = ctx;
  const baseUrl = opts.baseUrl || BASE_URL;
  const pyrimidProducts = opts.pyrimidProducts || PYRIMID_PRODUCTS;
  const pathname = new URL(path, baseUrl).pathname;
  const method = opts.method || "GET";
  const body = opts.body;
  const bodyHeaders = body ? { "Content-Type": "application/json" } : {};
  const bodyInit = body ? { body: JSON.stringify(body) } : {};

  // Use Pyrimid affiliate flow when affiliate_id present and product is registered.
  // Fall back to direct x402 if the affiliate route is unavailable or not yet cataloged.
  if (method === "GET" && affiliateId && pyrimidProducts[pathname]) {
    try {
      return await callPyrimid(account, path, affiliateId, baseUrl, pyrimidProducts);
    } catch (_) {
      affiliateId = null;
    }
  }

  // Standard x402 EIP-3009 flow
  const url = baseUrl + path;
  const extraHeaders = affiliateId ? { "X-Affiliate-ID": affiliateId } : {};
  const res = await fetch(url, { method, headers: { ...bodyHeaders, ...extraHeaders }, ...bodyInit });

  if (res.status === 402) {
    let body;
    try { body = await res.clone().json(); } catch (_) {}
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => res.headers.get(name), body
    );
    const paymentPayload = await createChainTimedPaymentPayload(httpClient, paymentRequired);
    const paidRes = await fetch(url, {
      method,
      headers: { ...bodyHeaders, ...httpClient.encodePaymentSignatureHeader(paymentPayload), ...extraHeaders },
      ...bodyInit,
    });
    if (!paidRes.ok) {
      const errBody = await paidRes.text().catch(() => paidRes.statusText);
      throw new Error(`HTTP ${paidRes.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await paidRes.json();
    try {
      const settleResponse = httpClient.getPaymentSettleResponse((name) => paidRes.headers.get(name));
      if (settleResponse && data && typeof data === "object" && !Array.isArray(data)) {
        return { ...data, _payment: settleResponse };
      }
    } catch (_) {}
    return data;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  let ctx;
  function getPaymentContext() {
    if (!ctx) ctx = buildHttpClient();
    return ctx;
  }

  const server = new Server(
    { name: "coinopai-mcp", version: "1.2.10" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      // Affiliate ID: tool arg takes precedence, then env fallback, then none
      const affiliateId = args.affiliate_id || process.env.PYRIMID_AFFILIATE_ID || null;
      const paymentContext = getPaymentContext();
      let data;
      switch (name) {
        // Low-value utility endpoints — no affiliate routing
        case "search_agent_automations":
          data = await callPaid(paymentContext, `/api/search?q=${encodeURIComponent(args.query || "")}&limit=${args.limit || 20}`, null);
          break;
        case "get_agent_automation":
          data = await callPaid(paymentContext, `/api/automation/${encodeURIComponent(args.slug)}`, null);
          break;
        case "list_automation_categories":
          data = await callPaid(paymentContext, "/api/categories", null);
          break;
        case "get_crypto_risk":
          data = await callPaid(paymentContext, "/api/kronos/risk", affiliateId);
          break;
        // High-value endpoints — affiliate routing enabled
        case "get_crypto_signals":
          data = await callPaid(paymentContext, "/api/kronos/signals", affiliateId);
          break;
        case "get_crypto_signal_history":
          data = await callPaid(paymentContext, `/api/kronos/history?hours=${args.hours || 24}`, affiliateId);
          break;
        case "get_crypto_decision":
          data = await callPaid(paymentContext, `/api/kronos/decision?symbol=${encodeURIComponent(args.symbol || "BTC")}`, affiliateId);
          break;
        case "check_trade_preflight":
          data = await callPaid(paymentContext, `/api/kronos/preflight?symbol=${encodeURIComponent(args.symbol || "BTC")}`, affiliateId);
          break;
        case "audit_trade_decision":
          data = await callPaid(paymentContext, `/api/kronos/audit?decision_id=${encodeURIComponent(args.decision_id)}&window=${encodeURIComponent(args.window || "4h")}`, affiliateId);
          break;
        case "get_crypto_forecast":
          data = await callPaid(paymentContext, `/api/kronos/forecast?symbol=${encodeURIComponent(args.symbol || "BTC")}`, affiliateId);
          break;
        case "review_signal_anomaly":
          data = await callPaid(paymentContext, "/api/anomaly", null, {
            method: "POST",
            body: {
              symbol: args.symbol || "BTC",
              window: args.window || "24h",
              features: args.features || {},
            },
          });
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
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}

main();
