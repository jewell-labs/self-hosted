import { readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { proveAccess } from "./prove.mjs";
import { cloudflareUnit, loadPolicy } from "./unit.mjs";

export async function setup(ctx) {
  const unit = cloudflareUnit();
  const dest = await ctx.writeState("cloudflare.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} access=${unit.access.required}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "cloudflare.json"), "utf8"));
  const expect = cloudflareUnit();
  if (JSON.stringify(written) !== JSON.stringify(expect)) {
    console.error("cloudflare unit does not match cloudflare");
    process.exit(1);
  }
  const mesh = JSON.parse(readFileSync(join(ctx.root, ".agents/mesh.json"), "utf8"));
  if (JSON.stringify(mesh.access) !== JSON.stringify(loadPolicy().access)) {
    console.error("mesh.json access does not match cloudflare/policy.json");
    process.exit(1);
  }
  for (const file of [expect.tunnel.tokenPath, expect.auth.idFile, expect.auth.secretFile]) {
    try {
      const stat = await lstat(file);
      if (stat.isFile() && (stat.mode & 0o777) !== 0o600) {
        console.error(`${file} must be mode 0600`);
        process.exit(1);
      }
    } catch {
      // Absent on a machine that has not installed the token yet.
    }
  }
  await proveAccess(ctx.root);
  console.log("cloudflare ok");
}
