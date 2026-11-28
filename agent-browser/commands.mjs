import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginVersion } from "../core/lib/plugins.mjs";

export async function setup(ctx) {
  const version = pluginVersion(ctx.root, "agent-browser");
  const unit = {
    version,
    installBrowsers: "agent-browser install",
    note: "Chrome for Testing is downloaded into the user directory. It is not stored in git.",
  };
  const dest = await ctx.writeState("agent-browser.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} version=${unit.version}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "agent-browser.json"), "utf8"));
  const version = pluginVersion(ctx.root, "agent-browser");
  if (written.version !== version || written.installBrowsers !== "agent-browser install") {
    console.error("agent-browser unit does not match agent-browser/plugin.json");
    process.exit(1);
  }
  console.log(`agent-browser ok ${written.version}`);
}
