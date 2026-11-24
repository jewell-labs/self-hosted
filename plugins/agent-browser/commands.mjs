import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function setup(ctx) {
  const pins = JSON.parse(readFileSync(join(ctx.root, "catalog/pins.json"), "utf8"));
  const unit = {
    version: pins["agent-browser"],
    installBrowsers: "agent-browser install",
    note: "Chrome for Testing is downloaded into the user directory. It is not stored in git.",
  };
  const dest = await ctx.writeState("agent-browser.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} version=${unit.version}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "agent-browser.json"), "utf8"));
  const pins = JSON.parse(readFileSync(join(ctx.root, "catalog/pins.json"), "utf8"));
  if (written.version !== pins["agent-browser"] || written.installBrowsers !== "agent-browser install") {
    console.error("agent-browser unit does not match catalog/pins.json");
    process.exit(1);
  }
  console.log(`agent-browser ok ${written.version}`);
}
