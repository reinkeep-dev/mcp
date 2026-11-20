import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy, evaluate, record, ROBINHOOD_CHAIN, USDG_ROBINHOOD, type PaymentRequest, type Policy, type LedgerEntry } from "../src/policy.ts";

const PAY_TO = "0xAbCdEf0000000000000000000000000000000001";
const good = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  network: ROBINHOOD_CHAIN,
  asset: USDG_ROBINHOOD,
  amount: "10000", // $0.01
  decimals: 6,
  payTo: PAY_TO,
  resourceUrl: "https://api.example.com/v1/data",
  validForSeconds: 90,
  quotedAmount: "10000",
  now: 1_000_000_000,
  ...over,
});
const known: Policy = { ...defaultPolicy, allowPayTo: [PAY_TO] };
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  ts: 1_000_000_000 - 1000,
  payTo: PAY_TO.toLowerCase(),
  amount: 1n,
  resourceUrl: "https://api.example.com/other",
  ...over,
});

test("allows a small payment to a known recipient", () => {
  assert.deepEqual(evaluate(good(), known, []), { verdict: "allow", reasons: [] });
});

test("first payment to an unknown recipient needs approval", () => {
  assert.deepEqual(evaluate(good(), defaultPolicy, []), { verdict: "approve", reasons: ["new_recipient"] });
});

test("recipient seen in the ledger is no longer new", () => {
  assert.equal(evaluate(good(), defaultPolicy, [entry()]).verdict, "allow");
});

test("above the approval threshold needs approval", () => {
  const d = evaluate(good({ amount: "60000", quotedAmount: "60000" }), known, []);
  assert.deepEqual(d, { verdict: "approve", reasons: ["above_approval_threshold"] });
});

test("over the per-payment cap is denied", () => {
  const d = evaluate(good({ amount: "150000", quotedAmount: "150000" }), known, []);
  assert.deepEqual(d.reasons, ["over_payment_cap"]);
  assert.equal(d.verdict, "deny");
});

test("wrong network and wrong asset are denied", () => {
  assert.ok(evaluate(good({ network: "eip155:8453" }), known, []).reasons.includes("network_not_allowed"));
  assert.ok(evaluate(good({ asset: "0x0000000000000000000000000000000000000bad" }), known, []).reasons.includes("asset_not_allowed"));
});

test("asset and recipient compare case-insensitively", () => {
  const d = evaluate(good({ asset: USDG_ROBINHOOD.toLowerCase(), payTo: PAY_TO.toUpperCase().replace("0X", "0x") }), known, []);
  assert.equal(d.verdict, "allow");
});

test("price raised after the quote is denied (injection tampering)", () => {
  const d = evaluate(good({ amount: "90000", quotedAmount: "10000" }), known, []);
  assert.deepEqual(d.reasons, ["amount_changed"]);
});

test("signature valid for too long is denied", () => {
  assert.deepEqual(evaluate(good({ validForSeconds: 3600 }), known, []).reasons, ["validity_too_long"]);
});

test("non-https and invalid resource urls are denied", () => {
  assert.deepEqual(evaluate(good({ resourceUrl: "http://api.example.com/x" }), known, []).reasons, ["resource_not_https"]);
  assert.deepEqual(evaluate(good({ resourceUrl: "not a url" }), known, []).reasons, ["resource_invalid"]);
});

test("host allowlist: subdomain ok, other host and lookalike denied", () => {
  const p: Policy = { ...known, allowHosts: ["example.com"] };
  assert.equal(evaluate(good(), p, []).verdict, "allow");
  assert.deepEqual(evaluate(good({ resourceUrl: "https://evil.com/x" }), p, []).reasons, ["host_not_allowed"]);
  assert.deepEqual(evaluate(good({ resourceUrl: "https://evilexample.com/x" }), p, []).reasons, ["host_not_allowed"]);
});

test("per-host cap is enforced", () => {
  const p: Policy = { ...known, hostCapsUsd: { "api.example.com": 0.005 } };
  assert.deepEqual(evaluate(good(), p, []).reasons, ["over_host_cap"]);
});

test("daily cap counts the last 24h only", () => {
  const big = (ts: number) => entry({ ts, amount: 950_000n, resourceUrl: "https://api.example.com/a" });
  const now = 1_000_000_000;
  const req = good({ amount: "100000", quotedAmount: "100000" });
  const p: Policy = { ...known, approveAboveUsd: 1 };
  assert.deepEqual(evaluate(req, p, [big(now - 3_600_000)]).reasons, ["over_daily_cap"]);
  assert.equal(evaluate(req, p, [big(now - 90_000_000)]).verdict, "allow");
});

test("duplicate payment inside the window is denied, later one is not", () => {
  const dup = (ageMs: number) => entry({ ts: 1_000_000_000 - ageMs, amount: 10_000n, resourceUrl: "https://api.example.com/v1/data" });
  assert.deepEqual(evaluate(good(), known, [dup(5_000)]).reasons, ["duplicate_payment"]);
  assert.equal(evaluate(good(), known, [dup(31_000)]).verdict, "allow");
});

test("rate limit: too many payments in a minute", () => {
  const many = Array.from({ length: 10 }, (_, i) => entry({ resourceUrl: `https://api.example.com/${i}` }));
  assert.deepEqual(evaluate(good(), known, many).reasons, ["rate_limit"]);
});

test("garbage amounts and non-6-decimal assets are denied", () => {
  for (const a of ["1e6", "-5", "", "0x10", "1.5"]) {
    assert.deepEqual(evaluate(good({ amount: a, quotedAmount: a }), known, []).reasons, ["invalid_amount"], a);
  }
  assert.ok(evaluate(good({ decimals: 18 }), known, []).reasons.includes("unsupported_decimals"));
});

test("all failing reasons are reported together", () => {
  const d = evaluate(good({ network: "eip155:1", validForSeconds: 9999, resourceUrl: "http://x.com" }), known, []);
  assert.equal(d.verdict, "deny");
  assert.deepEqual(d.reasons.sort(), ["network_not_allowed", "resource_not_https", "validity_too_long"]);
});

test("record lowercases the recipient and keeps the amount", () => {
  const e = record(good());
  assert.equal(e.payTo, PAY_TO.toLowerCase());
  assert.equal(e.amount, 10_000n);
});
