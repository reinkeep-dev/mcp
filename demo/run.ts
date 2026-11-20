#!/usr/bin/env node
// node demo/run.ts : replays the scripted attack and prints what the guard decided and why.
// Same output on every machine; compare the final hash.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDemo } from "./scenario.ts";

const result = runDemo(mkdtempSync(join(tmpdir(), "guard-demo-")));
const mark: Record<string, string> = { allow: "ALLOW  ", approve: "WAIT   ", deny: "DENY   " };

for (const e of result.events) {
  console.log(`\n${e.step}. ${e.title}`);
  console.log(`   ${e.story}`);
  console.log(`   -> ${mark[e.verdict]} ${e.reasons.join(", ") || "(no flags)"}  [${e.id}]`);
}
console.log(`\nAudit log: ${result.entries} entries, chain ${result.intact.ok ? "intact" : "BROKEN"}`);
console.log(`Forged copy (denial flipped to allow): ${result.tamper.ok ? "NOT detected" : `detected at entry ${result.tamper.badAt}`}`);
console.log(`Final hash: ${result.finalHash}`);
console.log("Scripted scenario with a fixed clock, not a live model.");

