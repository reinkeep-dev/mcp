// Glue: policy engine + saved history + human approvals + audit log.
// ponytail: state is one JSON file, not a database. Fine for one agent on one machine; if several
// processes write it at once, an entry can be lost. Move to SQLite when that matters.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { append } from "./audit.ts";
import { defaultPolicy, evaluate, record, type Decision, type LedgerEntry, type PaymentRequest, type Policy } from "./policy.ts";

export type State = { ledger: LedgerEntry[]; approvals: Record<string, number> };
export const APPROVAL_TTL_MS = 600_000; // a human approval is good for 10 minutes, once

export const requestId = (r: PaymentRequest): string =>
  createHash("sha256").update(JSON.stringify([r.network, r.asset.toLowerCase(), r.amount, r.payTo.toLowerCase(), r.resourceUrl])).digest("hex").slice(0, 16);

export function loadPolicy(file: string): Policy {
  return existsSync(file) ? { ...defaultPolicy, ...JSON.parse(readFileSync(file, "utf8")) } : defaultPolicy;
}

export function loadState(file: string): State {
  if (!existsSync(file)) return { ledger: [], approvals: {} };
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return { approvals: raw.approvals ?? {}, ledger: (raw.ledger ?? []).map((e: any) => ({ ...e, amount: BigInt(e.amount) })) };
}

export function saveState(file: string, s: State): void {
  writeFileSync(file, JSON.stringify({ approvals: s.approvals, ledger: s.ledger.map((e) => ({ ...e, amount: e.amount.toString() })) }));
}

// A human approval only upgrades "approve" to "allow". It can never undo a "deny".
export function check(req: PaymentRequest, policy: Policy, state: State, auditFile: string): Decision & { id: string } {
  const id = requestId(req);
  let d = evaluate(req, policy, state.ledger);
  const at = state.approvals[id];
  if (d.verdict === "approve" && at !== undefined && req.now - at <= APPROVAL_TTL_MS) {
    d = { verdict: "allow", reasons: ["human_approved"] };
    delete state.approvals[id];
  }
  if (d.verdict === "allow") state.ledger.push(record(req)); // counted when decided, before anything is signed
  append(auditFile, "decision", { id, verdict: d.verdict, reasons: d.reasons, network: req.network, amount: req.amount, payTo: req.payTo.toLowerCase(), resourceUrl: req.resourceUrl }, req.now);
  return { ...d, id };
}

export function approve(id: string, state: State, now: number): void {
  state.approvals[id] = now;
}

export type Paths = { policy: string; state: string; audit: string };

export function guardPaths(home = process.env.GUARD_HOME ?? join(homedir(), ".guard")): Paths {
  mkdirSync(home, { recursive: true });
  return { policy: join(home, "policy.json"), state: join(home, "state.json"), audit: join(home, "audit.jsonl") };
}

// Load, decide, save. Shared by the CLI, the MCP server and guardedSign.
export function checkAndSave(req: PaymentRequest, p: Paths): Decision & { id: string } {
  const state = loadState(p.state);
  const d = check(req, loadPolicy(p.policy), state, p.audit);
  saveState(p.state, state);
  return d;
}
