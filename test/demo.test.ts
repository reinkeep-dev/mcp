import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDemo } from "../demo/scenario.ts";

const fresh = () => runDemo(mkdtempSync(join(tmpdir(), "guard-demo-test-")));

test("demo decisions follow the story", () => {
  const r = fresh();
  assert.deepEqual(r.events.map((e) => e.verdict), ["allow", "deny", "deny", "deny", "deny", "approve", "approve", "allow"]);
  assert.deepEqual(r.events[1].reasons, ["duplicate_payment"]);
  assert.deepEqual(r.events[2].reasons, ["over_payment_cap"]);
  assert.deepEqual(r.events[3].reasons, ["amount_changed"]);
  assert.deepEqual(r.events[4].reasons, ["network_not_allowed", "asset_not_allowed"]);
  assert.deepEqual(r.events[5].reasons, ["new_recipient"]);
  assert.deepEqual(r.events[7].reasons, ["human_approved"]);
});

test("the attacker is never allowed, even by the small drip", () => {
  const attacker = fresh().events.filter((e) => e.request.payTo.toLowerCase().endsWith("dead"));
  assert.equal(attacker.length, 2);
  assert.ok(attacker.every((e) => e.verdict !== "allow"));
});

test("replay is deterministic: two runs give identical events and the same final hash", () => {
  const a = fresh();
  const b = fresh();
  assert.deepEqual(a.events, b.events);
  assert.equal(a.finalHash, b.finalHash);
  assert.match(a.finalHash, /^[0-9a-f]{64}$/);
});

test("audit log is intact, and flipping a denial to allow is caught at that entry", () => {
  const r = fresh();
  assert.equal(r.entries, 8);
  assert.deepEqual(r.intact, { ok: true });
  assert.deepEqual(r.tamper, { ok: false, badAt: 2 });
});
