#!/usr/bin/env node
// reinkeep-guard check --request '<json>'   exit 0 allow, 2 needs human approval, 3 denied
// reinkeep-guard approve <id>        run by a HUMAN; lets one waiting payment through once
// reinkeep-guard verify                     checks the audit log has not been edited
import { verify } from "./audit.ts";
import { approve, checkAndSave, guardPaths, loadState, saveState } from "./guard.ts";

const paths = guardPaths();
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));
const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

if (cmd === "check") {
  const raw = flag("request") ?? die("missing --request '<json>'");
  const d = checkAndSave({ now: Date.now(), ...JSON.parse(raw) }, paths);
  out(d);
  process.exit(d.verdict === "allow" ? 0 : d.verdict === "approve" ? 2 : 3);
} else if (cmd === "approve") {
  const id = rest[0] ?? die("usage: reinkeep-guard approve <id>");
  const state = loadState(paths.state);
  approve(id, state, Date.now());
  saveState(paths.state, state);
  out({ approved: id, validForMinutes: 10 });
} else if (cmd === "verify") {
  const r = verify(paths.audit);
  out(r);
  process.exit(r.ok ? 0 : 1);
} else {
  die("usage: reinkeep-guard check|approve|verify");
}
