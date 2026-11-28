import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addPlugin } from "../lib/lifecycle.mjs";

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) {
    console.error("usage: node core/bin/setup-existing.mjs --home DIR --root FIXTURE --add ID");
    process.exit(2);
  }
  return args[index + 1];
}

const home = flag("--home");
const fixture = flag("--root");
const id = flag("--add");
const core = dirname(dirname(fileURLToPath(import.meta.url)));
addPlugin(fixture, id);
const child = spawnSync(process.execPath, [join(fixture, id, "setup.mjs")], {
  cwd: fixture,
  env: { ...process.env, SELFHOST_HOME: home, SELFHOST_ROOT: fixture, SELFHOST_CORE: core },
  encoding: "utf8",
});
if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
process.exit(child.status ?? 1);
