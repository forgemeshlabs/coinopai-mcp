# Glama release build

Use this repository's Dockerfile for the Glama Dockerfile admin page:

```text
https://glama.ai/mcp/servers/forgemeshlabs/coinopai-mcp/admin/dockerfile
```

If the admin page asks for build steps, use:

```text
npm ci --omit=dev
```

CMD arguments:

```json
["node", "index.js"]
```

Environment variables schema:

```json
{
  "type": "object",
  "properties": {
    "WALLET_PRIVATE_KEY": {
      "description": "Base wallet private key for x402 micropayments",
      "type": "string"
    },
    "PYRIMID_AFFILIATE_ID": {
      "description": "Optional affiliate ID for Pyrimid attribution",
      "type": "string"
    }
  },
  "required": ["WALLET_PRIVATE_KEY"]
}
```

Runtime notes:

- Transport: stdio
- Authentication: wallet environment variable for paid x402 calls
- No inbound HTTP port is required
