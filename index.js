#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { registerExactEvmScheme } = require("@x402/evm/exact/client");
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
  "/api/kronos/signals":  { productId: 1n, priceUsdc: 50000n },
  "/api/kronos/decision": { productId: 2n, priceUsdc: 150000n },
};
const IMAGEGEN_URL = "https://imagegen.coinopai.com";
const PYRIMID_PRODUCTS_IMAGEGEN = {
  "/generate": { productId: 3n, priceUsdc: 100000n },
};

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
    inputSchema: {
      type: "object",
      properties: {
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      }
    }
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
        hours: { type: "number", description: "Hours of history to fetch (default 24, max 168)" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
      }
    }
  },
  {
    name: "get_crypto_decision",
    description: "Get a probabilistic trade decision from Kronos — then verify it. Returns CONSIDER_LONG/SHORT/NO_ACTION with confidence, regime, and a decision_id. Call audit_trade_decision with that ID after 1h to see if the decision was right. Full loop: preflight ($0.05) → decision ($0.15) → audit ($0.07) = $0.27 per verified cycle. Costs $0.15 USDC.",
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
    description: "Step 1 of the trade loop — checks if conditions allow a trade. Returns allowed:true/false, market state, cooldown, signal strength, warnings. If allowed, proceed to get_crypto_decision. Costs $0.05 USDC.",
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
    description: "The accountability step — verify any decision against real prices. Pass the decision_id from get_crypto_decision and a window (1h/4h/24h). Returns: did the direction hold? What was the PnL%? Verdict: GOOD_DECISION, BAD_DIRECTION, or NOISE. Every decision should be audited. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "UUID from a previous get_crypto_decision call" },
        window: { type: "string", description: "Evaluation window: 1h, 4h, or 24h (default: 4h)" },
        affiliate_id: { type: "string", description: "Optional Pyrimid affiliate ID (af_xxxxx). Affiliate earns a commission from within the listed price — no extra cost to you." }
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
  const coreClient = registerExactEvmScheme(new x402Client(), { signer });
  return { httpClient: new x402HTTPClient(coreClient), account };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Pyrimid affiliate flow — approve + routePayment on-chain, then retry with tx hash
async function callPyrimid(account, path, affiliateId, baseUrl, products) {
  const product = products[path];
  if (!product) throw new Error(`No Pyrimid product registered for ${path}`);
  const url = baseUrl + path;
  const transport = http();
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

  // Use Pyrimid affiliate flow when affiliate_id present and product is registered
  if (affiliateId && pyrimidProducts[path]) {
    return callPyrimid(account, path, affiliateId, baseUrl, pyrimidProducts);
  }

  // Standard x402 EIP-3009 flow
  const url = baseUrl + path;
  const extraHeaders = affiliateId ? { "X-Affiliate-ID": affiliateId } : {};
  const res = await fetch(url, { headers: extraHeaders });

  if (res.status === 402) {
    let body;
    try { body = await res.clone().json(); } catch (_) {}
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => res.headers.get(name), body
    );
    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const paidRes = await fetch(url, {
      headers: { ...httpClient.encodePaymentSignatureHeader(paymentPayload), ...extraHeaders },
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
  let ctx;
  try {
    ctx = buildHttpClient();
  } catch (e) {
    process.stderr.write("[coinopai-mcp] " + e.message + "\n");
    process.exit(1);
  }

  const server = new Server(
    { name: "coinopai-mcp", version: "1.2.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      // Affiliate ID: tool arg takes precedence, then env fallback, then none
      const affiliateId = args.affiliate_id || process.env.PYRIMID_AFFILIATE_ID || null;
      let data;
      switch (name) {
        // Low-value utility endpoints — no affiliate routing
        case "search_agent_automations":
          data = await callPaid(ctx, `/api/search?q=${encodeURIComponent(args.query || "")}&limit=${args.limit || 20}`, null);
          break;
        case "get_agent_automation":
          data = await callPaid(ctx, `/api/automation/${encodeURIComponent(args.slug)}`, null);
          break;
        case "list_automation_categories":
          data = await callPaid(ctx, "/api/categories", null);
          break;
        case "get_crypto_risk":
          data = await callPaid(ctx, "/api/kronos/risk", null);
          break;
        // High-value endpoints — affiliate routing enabled
        case "get_crypto_signals":
          data = await callPaid(ctx, "/api/kronos/signals", affiliateId);
          break;
        case "get_crypto_signal_history":
          data = await callPaid(ctx, `/api/kronos/history?hours=${args.hours || 24}`, affiliateId);
          break;
        case "get_crypto_decision":
          data = await callPaid(ctx, `/api/kronos/decision?symbol=${encodeURIComponent(args.symbol || "BTC")}`, affiliateId);
          break;
        case "check_trade_preflight":
          data = await callPaid(ctx, `/api/kronos/preflight?symbol=${encodeURIComponent(args.symbol || "BTC")}`, affiliateId);
          break;
        case "audit_trade_decision":
          data = await callPaid(ctx, `/api/kronos/audit?decision_id=${encodeURIComponent(args.decision_id)}&window=${encodeURIComponent(args.window || "4h")}`, affiliateId);
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
