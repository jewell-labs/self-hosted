import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { pluginDir } from "../lib/paths.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: core/bin/selfhost core/bin/check.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const stateDir = pluginDir(id);
const discovery = buildDiscovery();
const plugin = discovery.plugins.find((item) => item.id === id);
if (!plugin?.applicable) {
  console.error(`${id} is not applicable`);
  process.exit(1);
}

async function commandsFile(pluginId) {
  return join(root, pluginId, "commands.mjs");
}

const file = await commandsFile(id);
try {
  await stat(file);
} catch {
  console.error(`no check for ${id}`);
  process.exit(2);
}
const commands = await import(pathToFileURL(file).href);
await commands.check({
  root,
  stateDir,
  discovery,
  plugin,
});
