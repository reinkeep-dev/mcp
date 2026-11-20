# Reinkeep MCP

MCP server for [Reinkeep](https://reinkeep.xyz): ask before an agent pays on Robinhood Chain,
get `ALLOW`, `REVIEW` or `BLOCK`, the rule that decided it, and an EIP-712 signed receipt anyone can re-check.

It is a remote server, so there is nothing to install:

```
https://api.reinkeep.xyz/mcp
```

Streamable HTTP transport, stateless JSON-RPC. Reviewed by our team.

## Connect

**Claude Code**

```bash
claude mcp add --transport http reinkeep https://api.reinkeep.xyz/mcp
```

**Cursor, Windsurf and other clients that take a URL** (`mcp.json`):

```json
{
  "mcpServers": {
    "reinkeep": { "url": "https://api.reinkeep.xyz/mcp" }
  }
}
```

**Clients that only run local commands** (bridge through `mcp-remote`):

```json
{
  "mcpServers": {
    "reinkeep": { "command": "npx", "args": ["-y", "mcp-remote", "https://api.reinkeep.xyz/mcp"] }
  }
}
```

Quick check from a terminal:

```bash
curl -s -X POST https://api.reinkeep.xyz/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
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

Launch data comes from the open collector: [reinkeep-dev/data](https://github.com/reinkeep-dev/data).

## Local guard (runs on your machine)

This repo also holds a local guard: the same spend rules as the hosted gate, run on your own machine with no
network, no key and no account. It keeps its history in `$GUARD_HOME` (default `~/.guard`).

Node 22.18 or newer (it runs the `.ts` files directly, no build step, no dependencies).

```bash
npm test        # 48 tests
npm run demo    # replays a scripted attack; same decisions and same final hash on every machine
```

There are three ways in. Only the signer wrapper enforces.

**1. Signer wrapper (enforces).** The function that signs only runs when the verdict is `allow`, so an agent that
was tricked has no other path to the signature.

```ts
import { guardedSign } from "./src/sign.ts";
import { guardPaths } from "./src/guard.ts";

const r = await guardedSign(paymentRequest, () => account.signTypedData(typedData), guardPaths());
if (!r.signed) console.log(r.decision.verdict, r.decision.reasons); // "approve": a human runs the approve command
```

**2. CLI.**

```bash
node src/cli.ts check --request '{"network":"eip155:4663","asset":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","amount":"10000","decimals":6,"payTo":"0x00000000000000000000000000000000deadbeef","resourceUrl":"https://api.example.com/v1/data","validForSeconds":90,"quotedAmount":"10000"}'
# exit 0 = allow, 2 = a human must approve, 3 = denied
node src/cli.ts approve <id>   # run by a human, lets one waiting payment through once, for 10 minutes
node src/cli.ts verify         # checks the audit log was not edited
```

`amount` is in base units (6 decimals, so `10000` is $0.01). Pass `quotedAmount` from the first 402 quote; a
different amount at signing time is denied.

**3. MCP over stdio (advises).** Tools: `guard_check` and `guard_status`. There is no approve tool on purpose. An
agent that skips `guard_check` is not stopped, so use it next to the signer wrapper, not instead of it.

```json
{ "mcpServers": { "reinkeep-guard": { "command": "node", "args": ["/absolute/path/to/mcp/src/mcp-stdio.ts"] } } }
```

Token checks (mint, pause, blacklist, ticker copies, liquidity) need chain data, so they stay on the hosted gate:
use `check_token` or `gate_check` above.

**Policy.** Optional `$GUARD_HOME/policy.json`, merged over the defaults in `src/policy.ts`: `networks`, `assets`,
`perPaymentUsd` (0.10), `dailyUsd` (1), `approveAboveUsd` (0.05), `allowPayTo`, `allowHosts`, `hostCapsUsd`,
`maxValiditySec` (120), `duplicateWindowSec` (30), `maxPerMinute` (10).

`src/policy.ts` and `src/audit.ts` are copies of `engine/` in [reinkeep-dev/app](https://github.com/reinkeep-dev/app),
the code the hosted gate runs.

**Before relying on it:**
- The agent must not be able to write `GUARD_HOME` or run the approve command. If it can, an attacker who tricks the
  agent can approve their own payment.
- The audit log shows edits, not deletions from the end.
- v0 handles 6-decimal stablecoins only.

## Pricing

25 free calls a day per IP. After that $0.01 per call in USDG on Robinhood Chain over x402.
Live numbers: `get_pricing` or `https://api.reinkeep.xyz/api/v1/gate/pricing`.

## Also for agents

- `https://api.reinkeep.xyz/llms.txt`
- `https://api.reinkeep.xyz/.well-known/agent.json`
- `https://api.reinkeep.xyz/api/v1/openapi.json`
