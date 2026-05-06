# coinopai-mcp

[![npm version](https://img.shields.io/npm/v/coinopai-mcp)](https://www.npmjs.com/package/coinopai-mcp)
[![npm downloads](https://img.shields.io/npm/dm/coinopai-mcp)](https://www.npmjs.com/package/coinopai-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![payments](https://img.shields.io/badge/payments-x402%20USDC-0052FF)](https://x402.org)
[![network](https://img.shields.io/badge/network-Base-0052FF)](https://base.org)

**Paid decision infrastructure for autonomous agents.**

An MCP server that charges AI agents per verified intelligence request — using [x402](https://x402.org) micropayments on Base. Every decision gets a `decision_id`. Every `decision_id` can be audited against real prices.

> This repo is the MCP client layer; paid intelligence is served from hosted CoinOpAI x402 endpoints.

> Wrong predictions are shown too. That's the point.

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

| Tool | What it does | Cost |
|------|-------------|------|
| `check_trade_preflight` | Gate check: market allowed, cooldown, regime, signal strength | $0.05 |
| `get_crypto_decision` | CONSIDER\_LONG/SHORT/NO\_ACTION + `decision_id` | $0.15 |
| `audit_trade_decision` | Verify against real prices: verdict + PnL% | $0.07 |
| `get_crypto_signals` | Live directional signals for BTC, ETH, SOL, XRP, ADA | $0.05 |
| `get_crypto_risk` | Market risk state + regime detection | $0.02 |
| `get_crypto_signal_history` | Up to 168h of signal history | $0.05 |
| `search_agent_automations` | Search 819 agent automation prompts | $0.01 |
| `get_agent_automation` | Full prompt + workflow steps by slug | $0.01 |
| `list_automation_categories` | All 35 automation categories with counts | $0.005 |

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

Install via [Smithery](https://smithery.ai/server/coinopai-mcp). Configure a dedicated low-balance payment wallet. Do not use your primary wallet.

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

## Disclaimer

Decision outputs are probabilistic signals for experimental automated workflows only. Not financial advice. Early system with a small sample size. Results will vary. Never risk capital you can't afford to lose.

---

## License

MIT — see [LICENSE](LICENSE)
