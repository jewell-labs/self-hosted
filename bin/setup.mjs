import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { JailError, writeInside } from "../lib/jail.mjs";
import { readHost } from "../lib/host.mjs";
import { homeDir, layout } from "../lib/paths.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node bin/setup.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const home = homeDir();
const stateDir = process.env.SELFHOST_STATE ?? layout().state;

async function writeState(name, body) {
  try {
    return await writeInside(home, join(stateDir, name), body);
  } catch (error) {
    console.error(error instanceof JailError ? error.message : error.message);
    process.exit(1);
  }
}
const discovery = buildDiscovery();
const plugin = discovery.plugins.find((item) => item.id === id);
if (!plugin) {
  console.error(`unknown plugin ${id}`);
  process.exit(2);
}
if (!plugin.applicable) {
  console.error(`${id} is not applicable: ${plugin.reason}`);
  process.exit(1);
}

async function commandsFile(pluginId) {
  try {
    await stat(join(root, pluginId, ".agents", "mcp.json"));
    return join(root, pluginId, "commands.mjs");
  } catch {
    return join(root, "plugins", pluginId, "commands.mjs");
  }
}

const file = await commandsFile(id);
try {
  await stat(file);
} catch {
  console.error(`no setup for ${id}`);
  process.exit(2);
}
const commands = await import(pathToFileURL(file).href);
await commands.setup({
  root,
  stateDir,
  writeState,
  discovery,
  plugin,
  host: readHost(),
});
