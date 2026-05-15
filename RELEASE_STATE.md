# Release State

## Current Versions

| Surface | Version | URL |
|---------|---------|-----|
| npm | 1.2.3 | https://www.npmjs.com/package/coinopai-mcp |
| MCP Registry | 1.2.3 | https://registry.modelcontextprotocol.io/v0.1/servers/io.github.clawdbotworker%2Fcoinopai-mcp/versions/1.2.3 |

## Identity

| Field | Value |
|-------|-------|
| npm package name | coinopai-mcp |
| MCP Registry namespace | io.github.clawdbotworker/coinopai-mcp |
| Source repository | https://github.com/forgemeshlabs/coinopai-mcp |
| Registry status | active, isLatest: true |

## Why the namespace was preserved

The registry namespace `io.github.clawdbotworker` was kept deliberately. Migrating to `io.github.forgemeshlabs` would:

- Break install continuity for existing users
- Create duplicate registry identity risk
- Split discovery history across two namespaces
- Force migration messaging before the ecosystem is established

The repository URL points to `forgemeshlabs` — that's the real source of truth. The namespace is a stable identifier, not an org branding decision. Migration is a future deliberate event, not cleanup.

## Do not change without explicit approval

- `mcpName` in package.json
- `name` in server.json
- Registry namespace (via `mcp-publisher publish` from a different GitHub identity)
- npm package name
