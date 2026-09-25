# Changelog

## 2.2.0

- Added the Kronos Futures tools: `get_futures_decision` ($0.15), `get_perp_funding` ($0.02), `check_futures_risk` ($0.05) over `/api/kronos/futures/*`. Direction from the spot signal, stop/target on the calibrated 80% range, leverage cap, liquidation price, sizing, live funding from Kraken Futures + Hyperliquid. Market intelligence only; no exchange execution. Paid, so never carry a sponsored card.

## 2.1.0

- Added Lulu Ads sponsored cards (`ads.js`) as a labelled `sponsored: {label, text, url}` data field on free-tier tool responses only (`search_agent_automations`, `list_automation_categories`, `get_agent_automation`, `check_trade_preflight`), skipped whenever the response settled an x402 payment. Paid Kronos/anomaly tools never call the ads SDK.
- Cards require `LULU_ADS_PUBLISHER_ID` + `LULU_ADS_API_KEY`; missing creds or `LULU_ADS_ENABLED=false` means zero ads-network calls. Fail-open with a 2s hard budget.
- Added offline `test-ads.js`; `ads.js` added to the published `files` list.

## 1.2.10

- Pinned `@x402/core` and `@x402/evm` to `2.11.0` to avoid incompatible nested x402 client installs.
- Aligned EVM scheme registration with the live paid sweep path used by the CoinOpAI service.
- Sign x402 authorizations against latest Base block time to tolerate local/RPC clock skew.
- Include x402 settlement metadata in successful tool responses under `_payment`.
- Verified from a fresh npm install with a paid 10/10 MCP sweep on 2026-06-26.

## 1.2.9

- Added `review_signal_anomaly` MCP tool for paid `/api/anomaly` reviews.
- Added paid POST support in the MCP x402 client path.
- Refreshed public copy around anomaly review labels and market-intelligence-only positioning.

## 1.2.8

- Added Glama registry metadata for ForgeMesh maintainer verification.
- Published CoinOpAI MCP server for local stdio use.
