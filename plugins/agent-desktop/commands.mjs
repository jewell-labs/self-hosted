import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { layout } from "../../lib/paths.mjs";

export async function setup(ctx) {
  const pins = JSON.parse(readFileSync(join(ctx.root, "catalog/pins.json"), "utf8"));
  const dir = layout().agentDesktop;
  const unit = {
    version: pins["agent-desktop"],
    home: dir,
    env: "AGENT_DESKTOP_HOME",
    sandbox: {
      provider: "macos",
      install: "agent-desktop sandbox install macos",
      create: "agent-desktop sandbox create base --provider macos --set ipsw=latest",
      start: "agent-desktop sandbox start base",
      note: "The first macOS sandbox needs a person to finish Setup Assistant, run guest-setup.sh from the shared folder, and grant Accessibility. The guest network is not isolated. AGENT_DESKTOP_HOME is the plugin directory. Do not recreate ~/.agent-desktop.",
    },
  };
  const dest = await ctx.writeState("agent-desktop.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} version=${unit.version}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "agent-desktop.json"), "utf8"));
  const pins = JSON.parse(readFileSync(join(ctx.root, "catalog/pins.json"), "utf8"));
  const dir = layout().agentDesktop;
  if (written.version !== pins["agent-desktop"] || written.home !== dir || written.env !== "AGENT_DESKTOP_HOME" || !written.sandbox.note.includes("Accessibility")) {
    console.error("agent-desktop unit does not match catalog/pins.json");
    process.exit(1);
  }
  console.log(`agent-desktop ok ${written.version}`);
}
