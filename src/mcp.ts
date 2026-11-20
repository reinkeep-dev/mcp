// MCP request handler (JSON-RPC 2.0). Pure of stdio so it can be tested directly.
//
// ADVISORY ONLY: a tool the agent chooses to call cannot stop an agent that skips it.
// Enforcement lives in sign.ts (guardedSign), at the signer. These tools exist so an agent can
// ask before paying. Token checks live on the hosted gate (https://api.reinkeep.xyz/mcp).
// There is deliberately NO approve tool: approval is for a human, in a separate terminal.
import { verify } from "./audit.ts";
import { checkAndSave, loadPolicy, loadState, type Paths } from "./guard.ts";

type Msg = { jsonrpc?: string; id?: number | string | null; method?: string; params?: any };
type Schema = { properties: Record<string, { type: string }>; required?: string[] };

const str = { type: "string" };
const num = { type: "number" };

export const TOOLS = [
  {
    name: "guard_check",
    description:
      "ADVISORY. Ask before paying: returns allow, approve (a human must run `reinkeep-guard approve <id>` in their own terminal) or deny. Call it before every payment and pay only the exact amount to the exact recipient you checked. Counted against spending caps when checked.",
    inputSchema: {
      type: "object",
      properties: { network: str, asset: str, amount: { ...str, description: "base units, integer string (6 decimals: 10000 = $0.01)" }, decimals: num, payTo: str, resourceUrl: str, validForSeconds: num, quotedAmount: { ...str, description: "amount from the first 402 quote" } },
      required: ["network", "asset", "amount", "decimals", "payTo", "resourceUrl", "validForSeconds"],
    },
  },
  { name: "guard_status", description: "Spend in the last 24h, active limits, pending approvals and whether the audit log is intact.", inputSchema: { type: "object", properties: {} } },
];

// One source of truth: validate against the tool's own schema instead of a second hand-kept list.
function badFields(schema: Schema, a: any, nullable: boolean): string[] {
  return Object.keys(schema.properties).filter((k) => {
    const v = a[k];
    if (v === undefined || v === null) return !nullable && (schema.required ?? []).includes(k);
    return typeof v !== schema.properties[k].type;
  });
}

const ok = (id: Msg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Msg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (id: Msg["id"], body: unknown, isError = false) => ok(id, { content: [{ type: "text", text: JSON.stringify(body) }], isError });

function callTool(name: string, a: any, paths: Paths, now: number): { body: unknown; isError: boolean } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { body: { error: "unknown_tool", name }, isError: true };
  const bad = badFields(tool.inputSchema as Schema, a, false);
  if (bad.length) return { body: { error: "invalid_arguments", fields: bad }, isError: true };

  if (name === "guard_check") {
    const d = checkAndSave({ network: a.network, asset: a.asset, amount: a.amount, decimals: a.decimals, payTo: a.payTo, resourceUrl: a.resourceUrl, validForSeconds: a.validForSeconds, quotedAmount: a.quotedAmount ?? undefined, now }, paths);
    const next = d.verdict === "allow" ? "Allowed. Pay only this exact amount to this exact recipient." : d.verdict === "approve" ? `Do not pay yet. Ask the human to run: reinkeep-guard approve ${d.id}` : "Denied. Do not pay.";
    return { body: { ...d, next }, isError: false };
  }
  const s = loadState(paths.state);
  const p = loadPolicy(paths.policy);
  const day = s.ledger.filter((e) => now - e.ts < 86_400_000);
  return {
    body: {
      spent24hUsd: Number(day.reduce((t, e) => t + e.amount, 0n)) / 1e6,
      payments24h: day.length,
      limits: { perPaymentUsd: p.perPaymentUsd, dailyUsd: p.dailyUsd, approveAboveUsd: p.approveAboveUsd },
      pendingApprovals: Object.keys(s.approvals).length,
      audit: verify(paths.audit),
    },
    isError: false,
  };
}

export function handle(msg: Msg, paths: Paths, now = Date.now()): object | null {
  if (msg.id === undefined) return null; // notifications get no reply
  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "reinkeep-guard", version: "0.1.0" },
        instructions: "Advisory spend guard. Call guard_check before every payment. It cannot stop a payment you do not ask about; real enforcement is the signer wrapper.",
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string") return fail(id, -32602, "missing tool name");
      const r = callTool(name, msg.params?.arguments ?? {}, paths, now);
      return text(id, r.body, r.isError);
    }
    default:
      return fail(id, -32601, `method not found: ${msg.method}`);
  }
}
