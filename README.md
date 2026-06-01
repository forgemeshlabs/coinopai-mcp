# coinopai-mcp

[![npm version](https://img.shields.io/npm/v/coinopai-mcp)](https://www.npmjs.com/package/coinopai-mcp)
[![npm downloads](https://img.shields.io/npm/dm/coinopai-mcp)](https://www.npmjs.com/package/coinopai-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![payments](https://img.shields.io/badge/payments-x402%20USDC-0052FF)](https://x402.org)
[![network](https://img.shields.io/badge/network-Base-0052FF)](https://base.org)

**Directional market intelligence with built-in outcome verification.**

**Source:** https://github.com/forgemeshlabs/coinopai-mcp

An MCP server that lets AI agents buy Kronos market intelligence with [x402](https://x402.org) micropayments on Base. Kronos does not just generate signals: every decision gets a `decision_id`, and every `decision_id` can be audited against later market prices.

> This repo is the MCP client layer; paid intelligence is served from hosted CoinOpAI x402 endpoints.

> Wrong predictions are shown too. That's the point.

## Why Kronos Is Different

Most signal APIs stop after making a prediction. Kronos assigns a `decision_id` and lets every decision be audited against future market behavior.

The moat is the verification loop:

```
preflight -> decision -> audit
```

Trust the process less. Verify the record more.

---

## Architecture

```
┌──────────────────────────────────┐
│   Claude Code / AI Agent         │
└──────────────┬───────────────────┘
               │  MCP (stdio)
               ▼
┌──────────────────────────────────┐
│        coinopai-mcp              │
│    npx coinopai-mcp              │
└──────────────┬───────────────────┘
               │  HTTP + 402 payment header
               ▼
┌──────────────────────────────────┐
│      x402.coinopai.com           │
│   Kronos intelligence API        │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│   Coinbase x402 Facilitator      │
│   USDC settled on Base mainnet   │
└──────────────────────────────────┘
```

The agent calls a tool → the MCP server receives an `HTTP 402` → automatically signs a USDC micropayment → retries with the payment header → data returned. Configure once, pay automatically from the configured low-balance wallet.

---

## The Verified Loop ($0.27/cycle)

```
check_trade_preflight  ──→  get_crypto_decision  ──→  [wait 1h]  ──→  audit_trade_decision
       $0.05                      $0.15                                      $0.07

   Is now allowed?           CONSIDER_LONG/SHORT              GOOD_DECISION
   Cooldown check?           NO_ACTION                        BAD_DIRECTION
   Regime ok?                + decision_id                    NOISE
   Signal strength?          + next_step hint                 + pnl_pct
```

Every decision is self-verifying. The `decision_id` links the prediction to the outcome. The audit fetches real market prices and produces a verdict. Nothing is hidden.

## Current Status

**Live**
- Signals
- Risk assessment
- Decision guidance
- Outcome verification

**Research**
- Forecast intelligence: validation in progress
- Forecast vs execution agreement analysis: collecting evidence

Forecast outputs are not exposed publicly. Validation comes first.

## Signal Scale

| Signal | Meaning |
|--------|---------|
| Positive | Bullish directional read |
| Negative | Bearish directional read |
| 0.00-0.01 | Weak magnitude |
| 0.01-0.03 | Moderate magnitude |
| 0.03+ | Strong magnitude |

Signals are probabilistic model outputs, not guarantees or human recommendations.

---

## Real Output

**Step 1 — Preflight (BTC, $0.05)**
```json
{
  "allowed": true,
  "symbol": "BTC/USD",
  "market_state": "NORMAL",
  "signal_strength": 0.72,
  "regime": "TREND",
  "cooldown_remaining_seconds": 0
}
```

**Step 2 — Decision (BTC, $0.15)**
```json
{
  "symbol": "BTC/USD",
  "suggested_action": "CONSIDER_LONG",
  "confidence": 0.72,
  "regime": "TREND",
  "decision_id": "a3f8c1d2-9472-4dfe-b459-5df17b282614",
  "next_step": "Call audit_trade_decision with this decision_id after 1h using window=1h"
}
```

**Step 3 — Audit (1h later, $0.07)**
```json
{
  "decision_id": "a3f8c1d2-9472-4dfe-b459-5df17b282614",
  "direction_held": true,
  "pnl_pct": 0.82,
  "verdict": "GOOD_DECISION"
}
```

**Live results from real runs:**

| Symbol | Decision | Confidence | 1h Outcome | Verdict |
|--------|----------|-----------|------------|---------|
| XRP | SHORT | 1.0 | -0.54% | ✅ GOOD_DECISION |
| ETH | LONG | 0.68 | -0.32% | ❌ BAD_DIRECTION |
| BTC | LONG | 0.40 | +0.01% | — NOISE |

It gets some right. It gets some wrong. The loop makes both visible.

---

## Tools

| Tool | What it does | Cost | Affiliate |
|------|-------------|------|-----------|
| `check_trade_preflight` | Gate check: market allowed, cooldown, regime, signal strength | $0.05 | ✓ |
| `get_crypto_decision` | CONSIDER\_LONG/SHORT/NO\_ACTION + `decision_id` | $0.15 | ✓ |
| `audit_trade_decision` | Verify against real prices: verdict + PnL% | $0.07 | ✓ |
| `get_crypto_signals` | Directional market intelligence for BTC, ETH, SOL, XRP, ADA | $0.05 | ✓ |
| `get_crypto_signal_history` | Up to 168h of signal history for analysis | $0.05 | ✓ |
| `get_crypto_risk` | Market risk state and cooldown context | $0.02 | — |
| `search_agent_automations` | Search 819 agent automation prompts | $0.01 | — |
| `get_agent_automation` | Full prompt + workflow steps by slug | $0.01 | — |
| `list_automation_categories` | All 35 automation categories with counts | $0.005 | — |

No API keys. No subscriptions. Pay per call in USDC.

---

## Install

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "coinopai": {
      "command": "npx",
      "args": ["-y", "coinopai-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x<your-base-wallet-private-key>"
      }
    }
  }
}
```

Restart Claude Code. The 9 tools appear automatically.

### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "coinopai": {
      "command": "npx",
      "args": ["-y", "coinopai-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x<your-base-wallet-private-key>"
      }
    }
  }
}
```

### Smithery

Not currently listed on Smithery. Use the `npx` install flow shown above until a verified public listing is live.

### Registry status

Prepared MCP Registry identity: `io.github.forgemeshlabs/coinopai-mcp`. Refresh the public directory submission after publishing this package so old `clawdbotworker` entries stop being canonical.

---

## Get a Wallet

1. Install [Coinbase Wallet](https://wallet.coinbase.com) or any EVM wallet
2. Switch to **Base** network
3. Buy or bridge USDC ($1 = ~3 full verified cycles)
4. Use a dedicated low-balance Base wallet for agent payments and provide its private key locally via environment variable.

> Your wallet key stays local. It never leaves your machine. Each payment is a signed micropayment — not a blanket approval.

---

## Agent Code Example

```js
// Step 1 — gate check ($0.05)
const pre = await mcp.call("check_trade_preflight", { symbol: "BTC" })
if (!pre.allowed) return  // cooldown, bad regime, or stale data

// Step 2 — get decision ($0.15)
const dec = await mcp.call("get_crypto_decision", { symbol: "BTC" })
if (dec.suggested_action === "NO_ACTION") return

// Store the decision_id — you'll need it to close the loop
const { decision_id, suggested_action, confidence } = dec

// Step 3 — act on the decision here...

// Step 4 — audit 1 hour later ($0.07)
const audit = await mcp.call("audit_trade_decision", {
  decision_id,
  window: "1h"
})
// verdict: "GOOD_DECISION" | "BAD_DIRECTION" | "NOISE"
console.log(audit.verdict, audit.pnl_pct + "%")
```

Every decision response includes a `next_step` field — your agent always knows when and how to audit.

**Symbol unavailable?** If a symbol isn't in the current Kronos cycle:
```json
{
  "status": "UNAVAILABLE_THIS_CYCLE",
  "available_symbols": ["BTC/USD", "ETH/USD", "XRP/USD"],
  "retry_hint_seconds": 900
}
```
Route to an available symbol or wait 15 minutes for the next cycle.

---

## Payment Stack

| Component | Value |
|-----------|-------|
| Protocol | [x402](https://x402.org) |
| Scheme | ExactEvmScheme (EIP-3009 `transferWithAuthorization`) |
| Network | Base mainnet (`eip155:8453`) |
| Token | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| Facilitator | Coinbase |

---

## Affiliate Attribution (via Pyrimid)

High-value tools accept an optional `affiliate_id` parameter. When provided, payment routes through the [Pyrimid](https://pyrimid.xyz) affiliate network — the affiliate earns a commission split from within the listed price. **No extra cost to the caller.**

### How the split works

```
Direct call (no affiliate_id):
  Caller pays $0.15  →  CoinOpAI receives $0.15

Affiliate call (affiliate_id present):
  Caller pays $0.15  →  CoinOpAI: 79.2% ($0.1188)
                      →  Affiliate: 19.8% ($0.0297)
                      →  Protocol:   1.0% ($0.0015)
```

The buyer always pays the listed price. The split comes out of the vendor's portion.

### Usage

Pass `affiliate_id` in any supporting tool call:

```js
// As an agent or user
await mcp.call("get_crypto_decision", {
  symbol: "BTC",
  affiliate_id: "af_youraffiliateID"
})
```

### Building a wrapper? Set it once via env

If you're building an agent framework, MCP wrapper, or automation that embeds CoinOpAI tools, set your affiliate ID as an environment variable. Every call through your wrapper earns you a commission automatically.

```json
{
  "mcpServers": {
    "coinopai": {
      "command": "npx",
      "args": ["-y", "coinopai-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x<agent-wallet-key>",
        "PYRIMID_AFFILIATE_ID": "af_<your-affiliate-id>"
      }
    }
  }
}
```

The tool-level `affiliate_id` argument takes precedence over the env var. Callers can always override.

### Without an affiliate_id

Normal x402 flow — CoinOpAI receives 100% of the listed price. Nothing changes for the caller.

---

## Disclaimer

Decision outputs are probabilistic signals for experimental automated workflows only. Not financial advice. Early system with a small sample size. Results will vary. Never risk capital you can't afford to lose.

---

## Part of the ForgeMesh Ecosystem

Infrastructure for monetized agent ecosystems.

| Package | What | Install |
|---------|------|---------|
| [affiliate-router-mcp](https://github.com/forgemeshlabs/affiliate-router-mcp) | Vendor-neutral monetization routing | `npm i affiliate-router-mcp` |
| **coinopai-mcp** | Paid crypto intelligence (this package) | `npm i coinopai-mcp` |
| [forgemesh-imagegen](https://github.com/forgemeshlabs/imagegen-mcp) | Paid image generation MCP | `npm i forgemesh-imagegen` |

Each package works standalone. No shared dependency required.

---

## License

MIT — see [LICENSE](LICENSE)
