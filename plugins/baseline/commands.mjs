import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readHost } from "../../lib/host.mjs";

export async function setup(ctx) {
  const dest = await ctx.writeState("host.json", `${JSON.stringify({ schema: ctx.discovery.schema, host: ctx.host }, null, 2)}\n`);
  console.log(`wrote ${dest}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "host.json"), "utf8"));
  const host = readHost();
  if (written.host.os !== host.os || written.host.arch !== host.arch || written.schema !== ctx.discovery.schema) {
    console.error("baseline host.json does not match this host");
    process.exit(1);
  }
  console.log("baseline ok");
}
