import { readFile } from "node:fs/promises";
import { adminCall } from "./admin.mjs";

const method = process.argv[2];
const path = process.argv[3];
const file = process.argv[4] ?? "";
if (!method || !path) {
  process.stderr.write("usage: core/bin/selfhost cloudflare/api.mjs METHOD PATH [FILE]\n");
  process.exit(2);
}

let body = "";
if (file) {
  try {
    body = await readFile(file, "utf8");
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: "body" })}\n`);
    process.exit(1);
  }
}

const result = await adminCall({ method, path, body, env: process.env });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
