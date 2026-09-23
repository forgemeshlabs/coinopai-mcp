"use strict";

// Lulu Ads sponsored cards — disclosed data field, free-tier tools only.
//
// Contract:
//   - Card attaches ONLY to tools in FREE_TIER_TOOLS, and only when the
//     response carries no x402 `_payment` settlement receipt. A response
//     that settled a payment never carries a card, even for an allowlisted
//     tool. Every other tool (Kronos decision loop, anomaly review) is
//     excluded by name and never touches the SDK.
//   - The card is a plain data field `sponsored: {label, text, url}` on the
//     tool's JSON result — never injected into prose the model could read
//     as an instruction. Strip it with `delete result.sponsored`.
//   - This package ships NO ad credentials. ForgeMesh's own card is attached
//     server-side to GET /menu and passes through `list_tools` untouched
//     (see "never clobber an upstream field" below). The env path here
//     (LULU_ADS_PUBLISHER_ID, LULU_ADS_API_KEY) exists for forks that want
//     their own publisher card client-side. Either missing → zero network
//     calls, response unchanged. LULU_ADS_ENABLED=false is a kill switch.
//   - Fail-open with a hard time budget: SDK error, timeout, or import
//     failure → original response unchanged. Never throws.
//
// The SDK is deliberately NOT wired via `enableLuluAds`/`withLuluAds`
// from "lulu-ads/mcp": those wrap every registered tool, which would put
// cards on paid tools.

// Tools whose responses may carry a card. Everything else is paid-only.
//
// NOTE: `list_tools` is the one genuinely free tool (plain fetch of /menu,
// no callPaid, no `_payment`), so it is the only place a card renders today.
// The other four still go through callPaid and settle x402, so `_payment`
// is set and no card attaches; the switch for them is server-side — make the
// endpoint free (200 without a 402) and cards appear with no change here.
const FREE_TIER_TOOLS = new Set([
  "list_tools",
  "search_agent_automations",
  "list_automation_categories",
  "get_agent_automation",
  "check_trade_preflight",
]);

// Ad category forwarded to ads-server per tool (allowlisted context key).
const TOOL_CATEGORY = {
  list_tools: "agents.automation",
  search_agent_automations: "agents.automation",
  list_automation_categories: "agents.automation",
  get_agent_automation: "agents.automation",
  check_trade_preflight: "crypto.tools",
};

// Hard ceiling on the whole slot call (SDK's own default is 1500ms warm /
// 3000ms cold). We pass SDK_TIMEOUT_MS explicitly so the SDK never picks the
// 3000ms cold budget, and race it against HARD_BUDGET_MS as a belt-and-braces
// guard in case the SDK's AbortSignal misbehaves.
const SDK_TIMEOUT_MS = 1500;
const HARD_BUDGET_MS = 2000;

let clientPromise = null; // lazily-built LuluAds instance (or null when inert)

// Test seam: `setAdsClientForTests(fake)` swaps the SDK client; `null` resets.
let injectedClient;
function setAdsClientForTests(client) {
  injectedClient = client;
  clientPromise = null;
}

function adsEnabled(env = process.env) {
  if (String(env.LULU_ADS_ENABLED || "").toLowerCase() === "false") return false;
  return Boolean(env.LULU_ADS_PUBLISHER_ID && env.LULU_ADS_API_KEY);
}

// lulu-ads is ESM-only ("type": "module", `import` export only), so a
// CommonJS caller has to dynamic-import it. Done once, lazily, and only
// after the env guard passes — so no creds means the module is never even
// loaded, let alone warmed up (warmUp() would otherwise POST /telemetry/init
// with an empty key).
function getClient() {
  if (injectedClient !== undefined) return Promise.resolve(injectedClient);
  if (!clientPromise) {
    clientPromise = import("lulu-ads")
      .then(({ LuluAds }) => {
        const client = new LuluAds({
          publisherId: process.env.LULU_ADS_PUBLISHER_ID,
          apiKey: process.env.LULU_ADS_API_KEY,
        });
        void client.warmUp(); // fire-and-forget, never throws
        return client;
      })
      .catch(() => null);
  }
  return clientPromise;
}

function isFreeTierResponse(toolName, data) {
  if (!FREE_TIER_TOOLS.has(toolName)) return false;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data._payment) return false; // x402 settled → paid response, no card
  if ("sponsored" in data) return false; // never clobber an upstream field
  return true;
}

// Returns `data` with a `sponsored` field appended when a card is available,
// otherwise the exact same object. Never throws, never exceeds HARD_BUDGET_MS.
async function attachSponsored(toolName, data) {
  try {
    if (!adsEnabled()) return data;
    if (!isFreeTierResponse(toolName, data)) return data;
    const client = await getClient();
    if (!client) return data;

    const slot = client.sponsoredSlot({
      context: { tool: toolName, category: TOOL_CATEGORY[toolName] },
      timeoutMs: SDK_TIMEOUT_MS,
    });
    let timer;
    const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(null), HARD_BUDGET_MS); });
    const sponsored = await Promise.race([slot, budget]).catch(() => null);
    clearTimeout(timer);

    if (!sponsored || !sponsored.text || !sponsored.url) return data;
    return { ...data, sponsored: { label: "Sponsored", text: String(sponsored.text), url: String(sponsored.url) } };
  } catch (_) {
    return data;
  }
}

module.exports = { attachSponsored, adsEnabled, isFreeTierResponse, FREE_TIER_TOOLS, TOOL_CATEGORY, setAdsClientForTests };
