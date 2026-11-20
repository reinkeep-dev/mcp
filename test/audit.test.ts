import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { append, verify } from "../src/audit.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "guard-audit-")), "audit.jsonl");
const fill = (f: string) => {
  append(f, "decision", { verdict: "allow" }, 1);
  append(f, "decision", { verdict: "deny", reasons: ["over_payment_cap"] }, 2);
  append(f, "decision", { verdict: "approve" }, 3);
};

test("a missing or empty log verifies", () => {
  assert.deepEqual(verify(fresh()), { ok: true });
});

test("entries chain and verify", () => {
  const f = fresh();
  fill(f);
  assert.deepEqual(verify(f), { ok: true });
  const lines = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.seq), [0, 1, 2]);
  assert.equal(lines[1].prev, lines[0].hash);
});

test("editing an old entry is detected at that entry", () => {
  const f = fresh();
  fill(f);
  const lines = readFileSync(f, "utf8").trim().split("\n");
  const e = JSON.parse(lines[1]);
  e.data = { verdict: "allow" };
  lines[1] = JSON.stringify(e);
  writeFileSync(f, lines.join("\n") + "\n");
  assert.deepEqual(verify(f), { ok: false, badAt: 1 });
});

test("deleting a middle entry is detected at the next one", () => {
  const f = fresh();
  fill(f);
  const lines = readFileSync(f, "utf8").trim().split("\n");
  writeFileSync(f, [lines[0], lines[2]].join("\n") + "\n");
  assert.deepEqual(verify(f), { ok: false, badAt: 2 });
});

test("dropping the newest entry is NOT detected (known limit)", () => {
  const f = fresh();
  fill(f);
  const lines = readFileSync(f, "utf8").trim().split("\n");
  writeFileSync(f, lines.slice(0, 2).join("\n") + "\n");
  assert.deepEqual(verify(f), { ok: true });
});
