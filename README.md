# Reinkeep MCP

MCP server for [Reinkeep](https://reinkeep-site.reinkeep.workers.dev): ask before an agent pays on Robinhood Chain,
get `ALLOW`, `REVIEW` or `BLOCK`, the rule that decided it, and an EIP-712 signed receipt anyone can re-check.

It is a remote server, so there is nothing to install:

```
https://reinkeep-gate.reinkeep.workers.dev/mcp
```

Streamable HTTP transport, stateless JSON-RPC. Not audited.

## Connect

**Claude Code**

```bash
claude mcp add --transport http reinkeep https://reinkeep-gate.reinkeep.workers.dev/mcp
```

**Cursor, Windsurf and other clients that take a URL** (`mcp.json`):

```json
{
  "mcpServers": {
    "reinkeep": { "url": "https://reinkeep-gate.reinkeep.workers.dev/mcp" }
  }
}
```

**Clients that only run local commands** (bridge through `mcp-remote`):

```json
{
  "mcpServers": {
    "reinkeep": { "command": "npx", "args": ["-y", "mcp-remote", "https://reinkeep-gate.reinkeep.workers.dev/mcp"] }
  }
}
```

Quick check from a terminal:

```bash
curl -s -X POST https://reinkeep-gate.reinkeep.workers.dev/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

| Tool | What it does |
|---|---|
| `gate_check` | Ask before you pay: ALLOW, REVIEW or BLOCK for a payment (and optionally the token it buys), with the rule codes and a signed receipt. |
| `verify_receipt` | Re-check a receipt: valid plus the signer, or invalid plus the reason. |
| `get_receipt` | Fetch a stored receipt by id with a fresh signature check. |
| `get_signer` | The signer address and EIP-712 domain and types, to check receipts yourself. |
| `get_pricing` | Free calls per day, price per call, asset, network and payTo address. |
| `list_presets` | Built-in policies you can pass to `gate_check`. |
| `check_token` | Free token check from the token rules only (mint with a live owner, blacklist, pause, upgradeable, ticker copy, low liquidity). |
| `create_mandate` | Keep watching a token you bought for 7 days; each 30-minute check gives a signed exit, watch or hold signal. |
| `get_mandate` | A mandate's state, expiry, checks so far and latest signal. |
| `mandate_events` | Every check, change and failed read of a mandate. |
| `verify_signal` | Check a mandate signal was signed by Reinkeep and is still valid. |
| `premortem` | For builders before a launch: the decision agents will get, the risks with fixes, ticker reuse, how similar launches did. |
| `launch_odds` | How many launches still traded a day later, by first liquidity and first swaps. |
| `launch_board` | Per day: pools seen, re-checked, alive, dead. |
| `ticker_radar` | Tickers reused by 2 or more tokens lately. |
| `token_autopsy` | What happened to one token a day after launch. |

Launch data comes from the open collector: [reinkeep/data](https://github.com/reinkeep/data).

## Pricing

25 free calls a day per IP. After that $0.01 per call in USDG on Robinhood Chain over x402.
Live numbers: `get_pricing` or `https://reinkeep-gate.reinkeep.workers.dev/api/v1/gate/pricing`.

## Also for agents

- `https://reinkeep-gate.reinkeep.workers.dev/llms.txt`
- `https://reinkeep-gate.reinkeep.workers.dev/.well-known/agent.json`
- `https://reinkeep-gate.reinkeep.workers.dev/api/v1/openapi.json`
