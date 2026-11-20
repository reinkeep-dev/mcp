#!/usr/bin/env node
// MCP over stdio: one JSON message per line. Add to a client as: command "node", args [".../src/mcp-stdio.ts"].
import { createInterface } from "node:readline";
import { guardPaths } from "./guard.ts";
import { handle } from "./mcp.ts";

const paths = guardPaths();
const send = (m: object) => process.stdout.write(JSON.stringify(m) + "\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  const reply = handle(msg, paths);
  if (reply) send(reply);
});
