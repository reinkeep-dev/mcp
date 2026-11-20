import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardPaths, loadState, saveState } from "../src/guard.ts";
import { handle, TOOLS } from "../src/mcp.ts";
import { guardedSign } from "../src/sign.ts";
import { ROBINHOOD_CHAIN, USDG_ROBINHOOD, type PaymentRequest } from "../src/policy.ts";

const home = () => mkdtempSync(join(tmpdir(), "guard-mcp-"));
const PAY_TO = "0xAbCdEf0000000000000000000000000000000001";
const pay = { network: ROBINHOOD_CHAIN, asset: USDG_ROBINHOOD, amount: "10000", decimals: 6, payTo: PAY_TO, resourceUrl: "https://api.example.com/v1/data", validForSeconds: 90, quotedAmount: "10000" };
const require_state = (p: ReturnType<typeof guardPaths>) => {
  const s = loadState(p.state);
  return Object.assign(s, { save: () => saveState(p.state, s) });
};
const call = (paths: ReturnType<typeof guardPaths>, name: string, args: object, id = 1) => {
  const r: any = handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, paths, 1_000_000_000);
  return { isError: r.result.isError, body: JSON.parse(r.result.content[0].text) };
};

test("tool list is exactly check and status; there is no approve tool", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["guard_check", "guard_status"]);
  const r: any = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, guardPaths(home()));
  assert.equal(r.result.tools.length, 2);
  assert.ok(!JSON.stringify(r).toLowerCase().includes('"name":"guard_approve"'));
});

test("initialize replies, notifications get no reply, unknown method errors", () => {
  const p = guardPaths(home());
  const init: any = handle({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-06-18" } }, p);
  assert.equal(init.id, 7);
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }, p), null);
  assert.equal((handle({ jsonrpc: "2.0", id: 2, method: "nope" }, p) as any).error.code, -32601);
  assert.deepEqual((handle({ jsonrpc: "2.0", id: 3, method: "ping" }, p) as any).result, {});
});

test("guard_check: injected price is denied, new recipient waits for a human", () => {
  const p = guardPaths(home());
  const injected = call(p, "guard_check", { ...pay, amount: "900000" });
  assert.deepEqual([injected.isError, injected.body.verdict], [false, "deny"]);
  assert.ok(injected.body.reasons.includes("amount_changed"));
  assert.match(injected.body.next, /Do not pay/);
  const fresh = call(p, "guard_check", pay);
  assert.equal(fresh.body.verdict, "approve");
  assert.match(fresh.body.next, new RegExp(`reinkeep-guard approve ${fresh.body.id}`));
});

test("guard_check rejects wrong argument types instead of guessing", () => {
  const p = guardPaths(home());
  const r = call(p, "guard_check", { ...pay, amount: 10000, decimals: "6" });
  assert.equal(r.isError, true);
  assert.deepEqual(r.body.fields.sort(), ["amount", "decimals"]);
});

test("guard_status works, unknown tool is an error", () => {
  const p = guardPaths(home());
  const s = call(p, "guard_status", {});
  assert.deepEqual([s.body.spent24hUsd, s.body.payments24h, s.body.audit], [0, 0, { ok: true }]);
  assert.equal(call(p, "nope", {}).isError, true);
});

test("a payment waiting for approval is not counted as spend", () => {
  const p = guardPaths(home());
  assert.equal(call(p, "guard_check", pay).body.verdict, "approve"); // unknown recipient
  assert.equal(call(p, "guard_status", {}).body.payments24h, 0);
});

test("an allowed check is counted as spend and shows in status", () => {
  const p = guardPaths(home());
  const fs = require_state(p);
  fs.ledger.push({ ts: 999_000_000, payTo: PAY_TO.toLowerCase(), amount: 1n, resourceUrl: "https://api.example.com/seed" }); // makes the recipient known
  fs.save();
  assert.equal(call(p, "guard_check", pay).body.verdict, "allow");
  const s = call(p, "guard_status", {}).body;
  assert.deepEqual([s.payments24h, s.spent24hUsd], [2, 0.010001]);
});

test("stdio server: replies by id over real stdin/stdout, silent on notifications", () => {
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ].map((m) => JSON.stringify(m)).join("\n") + "\nnot json\n";
  const r = spawnSync(process.execPath, ["src/mcp-stdio.ts"], { input: lines, env: { ...process.env, GUARD_HOME: home() }, encoding: "utf8" });
  const out = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(out.map((o) => o.id), [1, 2, null]);
  assert.equal(out[1].result.tools.length, 2);
  assert.equal(out[2].error.code, -32700);
});

// --- enforcement: guardedSign ---
const sreq = (o: Partial<PaymentRequest> = {}): PaymentRequest => ({ ...pay, now: 1_000_000_000, ...o });

test("guardedSign: signer runs only on allow", async () => {
  const p = guardPaths(home());
  const calls: string[] = [];
  const sign = async () => (calls.push("signed"), "sig");
  const denied = await guardedSign(sreq({ amount: "900000" }), sign, p);
  assert.deepEqual([denied.signed, denied.decision.verdict, calls.length], [false, "deny", 0]);
  const waiting = await guardedSign(sreq(), sign, p);
  assert.deepEqual([waiting.signed, waiting.decision.verdict, calls.length], [false, "approve", 0]);
});

test("guardedSign: after a human approves, it signs once", async () => {
  const p = guardPaths(home());
  const { approve, loadState, saveState } = await import("../src/guard.ts");
  const calls: string[] = [];
  const sign = async () => (calls.push("signed"), "sig");
  const first = await guardedSign(sreq(), sign, p);
  const s = loadState(p.state);
  approve(first.decision.id, s, 1_000_000_000);
  saveState(p.state, s);
  const second = await guardedSign(sreq({ now: 1_000_030_000 }), sign, p);
  assert.deepEqual([second.signed, second.result, calls.length], [true, "sig", 1]);
});

test("guardedSign: a signer that throws still counts toward the daily cap", async () => {
  const p = guardPaths(home());
  const { loadState, saveState } = await import("../src/guard.ts");
  const s0 = loadState(p.state);
  s0.ledger.push({ ts: 999_000_000, payTo: PAY_TO.toLowerCase(), amount: 1n, resourceUrl: "https://api.example.com/seed" });
  saveState(p.state, s0); // make the recipient known so the next payment is allowed
  await assert.rejects(guardedSign(sreq(), async () => { throw new Error("hsm offline"); }, p), /hsm offline/);
  assert.equal(loadState(p.state).ledger.length, 2);
});
