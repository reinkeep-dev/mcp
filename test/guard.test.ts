import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "../src/audit.ts";
import { APPROVAL_TTL_MS, approve, check, loadState, requestId, saveState } from "../src/guard.ts";
import { defaultPolicy, ROBINHOOD_CHAIN, USDG_ROBINHOOD, type PaymentRequest } from "../src/policy.ts";

const dir = () => mkdtempSync(join(tmpdir(), "guard-"));
const PAY_TO = "0xAbCdEf0000000000000000000000000000000001";
const req = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  network: ROBINHOOD_CHAIN, asset: USDG_ROBINHOOD, amount: "10000", decimals: 6, payTo: PAY_TO,
  resourceUrl: "https://api.example.com/v1/data", validForSeconds: 90, quotedAmount: "10000", now: 1_000_000_000, ...over,
});
const policy = { ...defaultPolicy, allowPayTo: [PAY_TO] };

test("an allowed payment is recorded, so an identical one right after is a duplicate", () => {
  const audit = join(dir(), "a.jsonl");
  const state = { ledger: [], approvals: {} };
  assert.equal(check(req(), policy, state, audit).verdict, "allow");
  assert.equal(state.ledger.length, 1);
  const again = check(req({ now: 1_000_005_000 }), policy, state, audit);
  assert.deepEqual([again.verdict, again.reasons], ["deny", ["duplicate_payment"]]);
});

test("a denied payment is not recorded", () => {
  const state = { ledger: [], approvals: {} };
  check(req({ amount: "900000", quotedAmount: "900000" }), policy, state, join(dir(), "a.jsonl"));
  assert.equal(state.ledger.length, 0);
});

test("human approval lets a waiting payment through exactly once", () => {
  const audit = join(dir(), "a.jsonl");
  const state = { ledger: [], approvals: {} };
  const big = req({ amount: "60000", quotedAmount: "60000" }); // $0.06, above the $0.05 threshold
  const first = check(big, policy, state, audit);
  assert.deepEqual([first.verdict, first.reasons], ["approve", ["above_approval_threshold"]]);
  approve(first.id, state, big.now);
  const second = check({ ...big, now: big.now + 40_000 }, policy, state, audit);
  assert.deepEqual([second.verdict, second.reasons], ["allow", ["human_approved"]]);
  const third = check({ ...big, now: big.now + 80_000 }, policy, state, audit);
  assert.equal(third.verdict, "approve"); // approval was consumed
});

test("an approval expires", () => {
  const state = { ledger: [], approvals: {} };
  const big = req({ amount: "60000", quotedAmount: "60000" });
  const id = requestId(big);
  approve(id, state, big.now);
  const d = check({ ...big, now: big.now + APPROVAL_TTL_MS + 1 }, policy, state, join(dir(), "a.jsonl"));
  assert.equal(d.verdict, "approve");
});

test("an approval can never override a denial", () => {
  const state = { ledger: [], approvals: {} };
  const bad = req({ amount: "900000", quotedAmount: "900000" });
  approve(requestId(bad), state, bad.now);
  const d = check(bad, policy, state, join(dir(), "a.jsonl"));
  assert.deepEqual([d.verdict, d.reasons], ["deny", ["over_payment_cap"]]);
});

test("approval for one request does not cover a different recipient or amount", () => {
  const state = { ledger: [], approvals: {} };
  const a = req({ amount: "60000", quotedAmount: "60000" });
  approve(requestId(a), state, a.now);
  assert.notEqual(requestId(a), requestId({ ...a, payTo: "0x0000000000000000000000000000000000000002" }));
  assert.notEqual(requestId(a), requestId({ ...a, amount: "70000" }));
});

test("every check is written to a verifiable audit log", () => {
  const audit = join(dir(), "a.jsonl");
  const state = { ledger: [], approvals: {} };
  check(req(), policy, state, audit);
  check(req({ network: "eip155:1" }), policy, state, audit);
  assert.deepEqual(verify(audit), { ok: true });
});

test("state survives a save and load, bigint included", () => {
  const f = join(dir(), "s.json");
  const state = { ledger: [{ ts: 5, payTo: "0xabc", amount: 123456789012345678901n, resourceUrl: "https://x.com" }], approvals: { abc: 9 } };
  saveState(f, state);
  assert.deepEqual(loadState(f), state);
  assert.deepEqual(loadState(join(dir(), "none.json")), { ledger: [], approvals: {} });
});

// --- CLI, as a real subprocess with its own GUARD_HOME ---
const run = (home: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, ["src/cli.ts", ...args], { env: { ...process.env, GUARD_HOME: home }, encoding: "utf8" });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
};
const body = (o: object) => JSON.stringify({ ...req(), now: undefined, ...o });

test("cli: allow=0, approve=2, deny=3, then human approval flips approve to allow", () => {
  const home = dir();
  const small = run(home, "check", "--request", body({ amount: "10000", quotedAmount: "10000" }));
  assert.equal(small.code, 2); // new recipient, no allowlist in the default policy
  const id = small.out.id;
  assert.equal(run(home, "approve", id).code, 0);
  const afterApproval = run(home, "check", "--request", body({ amount: "10000", quotedAmount: "10000" }));
  assert.deepEqual([afterApproval.code, afterApproval.out.reasons], [0, ["human_approved"]]);
  const bad = run(home, "check", "--request", body({ network: "eip155:1" }));
  assert.equal(bad.code, 3);
  assert.deepEqual(run(home, "verify").out, { ok: true });
});

test("cli: missing arguments", () => {
  const home = dir();
  const r = spawnSync(process.execPath, ["src/cli.ts", "check"], { env: { ...process.env, GUARD_HOME: home }, encoding: "utf8" });
  assert.equal(r.status, 1);
});
