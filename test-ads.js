#!/usr/bin/env node
"use strict";

// Offline tests for the Lulu Ads wiring (ads.js). No network, no wallet.
// Run: node test-ads.js

const assert = require("node:assert/strict");
const { attachSponsored, isFreeTierResponse, FREE_TIER_TOOLS, TOOL_CATEGORY, setAdsClientForTests } = require("./ads.js");

const PAID_TOOLS = [
  "get_crypto_signals", "get_crypto_risk", "get_crypto_signal_history", "get_crypto_decision",
  "audit_trade_decision", "get_crypto_forecast", "review_signal_anomaly",
];

function fakeClient(behaviour) {
  const calls = [];
  return {
    calls,
    async sponsoredSlot(opts) {
      calls.push(opts);
      return behaviour(opts);
    },
  };
}

const CARD = { label: "Sponsored", text: "Try Acme", url: "https://acme.example/?ref=lulu", logoUrl: "https://acme.example/logo.png" };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.log(`FAIL ${name}\n     ${e.message}`); process.exitCode = 1; }
}

(async () => {
  process.env.LULU_ADS_PUBLISHER_ID = "pub_test";
  process.env.LULU_ADS_API_KEY = "key_test";
  delete process.env.LULU_ADS_ENABLED;

  await test("(a) free tool response gets `sponsored` when the slot returns one", async () => {
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    const input = { results: [{ slug: "slack-to-notion" }] };
    const out = await attachSponsored("search_agent_automations", input);
    assert.deepEqual(out.sponsored, { label: "Sponsored", text: CARD.text, url: CARD.url });
    assert.deepEqual(out.results, input.results);
    assert.ok(!("sponsored" in input), "input object must not be mutated");
    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.calls[0].context, { tool: "search_agent_automations", category: "agents.automation" });
    assert.equal(typeof client.calls[0].timeoutMs, "number");
  });

  await test("(a2) every free-tier tool has a category and reaches the SDK", async () => {
    for (const tool of FREE_TIER_TOOLS) {
      const client = fakeClient(() => CARD);
      setAdsClientForTests(client);
      const out = await attachSponsored(tool, { ok: true });
      assert.equal(out.sponsored.url, CARD.url, tool);
      assert.equal(client.calls[0].context.category, TOOL_CATEGORY[tool], tool);
    }
  });

  await test("(b) paid tools never call the SDK, output unchanged", async () => {
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    for (const tool of PAID_TOOLS) {
      assert.ok(!FREE_TIER_TOOLS.has(tool), `${tool} must not be free-tier`);
      const input = { symbol: "BTC", bias: "up" };
      const out = await attachSponsored(tool, input);
      assert.equal(out, input, tool);
    }
    assert.equal(client.calls.length, 0, "SDK must not be called for paid tools");
  });

  await test("(b2) allowlisted tool whose response settled x402 payment gets no card, no SDK call", async () => {
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    const input = { categories: [], _payment: { success: true, transaction: "0xabc" } };
    const out = await attachSponsored("list_automation_categories", input);
    assert.equal(out, input);
    assert.equal(client.calls.length, 0);
    assert.equal(isFreeTierResponse("list_automation_categories", input), false);
  });

  await test("(c) missing creds → no SDK call, output unchanged", async () => {
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    const input = { results: [] };
    for (const missing of ["LULU_ADS_PUBLISHER_ID", "LULU_ADS_API_KEY"]) {
      const saved = process.env[missing];
      delete process.env[missing];
      const out = await attachSponsored("search_agent_automations", input);
      assert.equal(out, input, missing);
      process.env[missing] = saved;
    }
    assert.equal(client.calls.length, 0);
  });

  await test("(c2) LULU_ADS_ENABLED=false kill switch → no SDK call, output unchanged", async () => {
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    process.env.LULU_ADS_ENABLED = "false";
    const input = { results: [] };
    const out = await attachSponsored("search_agent_automations", input);
    delete process.env.LULU_ADS_ENABLED;
    assert.equal(out, input);
    assert.equal(client.calls.length, 0);
  });

  await test("(c3) real SDK with no creds is inert (no fetch)", async () => {
    setAdsClientForTests(undefined); // use the real lulu-ads client
    const savedFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; throw new Error("network must not be touched"); };
    // SDK falls back to env when opts are undefined, so clear env too.
    const savedEnv = { id: process.env.LULU_ADS_PUBLISHER_ID, key: process.env.LULU_ADS_API_KEY };
    delete process.env.LULU_ADS_PUBLISHER_ID; delete process.env.LULU_ADS_API_KEY;
    const { LuluAds } = await import("lulu-ads");
    const client = new LuluAds({});
    const slot = await client.sponsoredSlot({ context: { tool: "x" } });
    globalThis.fetch = savedFetch;
    process.env.LULU_ADS_PUBLISHER_ID = savedEnv.id; process.env.LULU_ADS_API_KEY = savedEnv.key;
    assert.equal(slot, null);
    assert.equal(fetches, 0);
  });

  await test("(d) SDK throwing → output unchanged", async () => {
    const client = fakeClient(() => { throw new Error("boom"); });
    setAdsClientForTests(client);
    const input = { results: [] };
    const out = await attachSponsored("get_agent_automation", input);
    assert.equal(out, input);
  });

  await test("(d2) SDK rejecting / returning null / malformed → output unchanged", async () => {
    const input = { results: [] };
    for (const behaviour of [() => Promise.reject(new Error("nope")), () => null, () => ({ text: "no url" })]) {
      setAdsClientForTests(fakeClient(behaviour));
      const out = await attachSponsored("get_agent_automation", input);
      assert.equal(out, input);
    }
  });

  await test("(d3) SDK hanging past the hard budget → output unchanged within ~2s", async () => {
    setAdsClientForTests(fakeClient(() => new Promise(() => {}))); // never resolves
    const input = { results: [] };
    const t0 = Date.now();
    const out = await attachSponsored("get_agent_automation", input);
    const ms = Date.now() - t0;
    assert.equal(out, input);
    assert.ok(ms >= 1900 && ms < 3000, `budget elapsed ${ms}ms`);
  });

  await test("(f) list_tools is card-eligible and never goes through callPaid", async () => {
    assert.ok(FREE_TIER_TOOLS.has("list_tools"));
    assert.equal(TOOL_CATEGORY.list_tools, "agents.automation");
    const client = fakeClient(() => CARD);
    setAdsClientForTests(client);
    const out = await attachSponsored("list_tools", { service: "coinopai", tools: [] });
    assert.equal(out.sponsored.url, CARD.url);
    assert.equal(client.calls[0].context.tool, "list_tools");
    // Source-level guard: the list_tools branch fetches /menu directly and
    // the wallet context is skipped for it, so no payment can ever fire.
    const src = require("node:fs").readFileSync(__dirname + "/index.js", "utf8");
    const branch = src.slice(src.indexOf('case "list_tools"'), src.indexOf("break;", src.indexOf('case "list_tools"')));
    assert.ok(branch.includes("fetch(`${BASE_URL}/menu`)"), "list_tools must fetch /menu");
    assert.ok(!branch.includes("callPaid"), "list_tools must not call callPaid");
    assert.ok(src.includes('name === "list_tools" ? null : getPaymentContext()'), "wallet must not be required for list_tools");
  });

  await test("(e) index.js only wires the free-tier allowlist", async () => {
    const src = require("node:fs").readFileSync(__dirname + "/index.js", "utf8");
    assert.ok(src.includes('require("./ads.js")'));
    assert.ok(src.includes("if (FREE_TIER_TOOLS.has(name)) data = await attachSponsored(name, data);"));
    assert.ok(!src.includes("enableLuluAds") && !src.includes("withLuluAds"), "must not use the wrap-all-tools helpers");
  });

  setAdsClientForTests(undefined);
  console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
})();
