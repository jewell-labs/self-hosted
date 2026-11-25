import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { agentsDirectory } from "../lib/launchd.mjs";
import { pluginDir } from "../lib/paths.mjs";
import { tickLive } from "../evals/live.mjs";
import { tick } from "../work/routines.mjs";

const command = process.argv[2] ?? "tick";
const root = repoRoot();

if (command === "tick") {
  const lines = [...await tick(), ...await tickLive()];
  console.log(lines.join("\n"));
} else if (command === "install") {
  const label = "com.jewell-labs.routines";
  const log = join(pluginDir("work"), "logs", "routines.log");
  await mkdir(join(pluginDir("work"), "logs"), { recursive: true });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${join(root, "bin/routines.mjs")}</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
  const saved = join(pluginDir("work"), "launchd", `${label}.plist`);
  await mkdir(join(pluginDir("work"), "launchd"), { recursive: true });
  await writeFile(saved, body);
  const live = join(agentsDirectory(), `${label}.plist`);
  await mkdir(agentsDirectory(), { recursive: true });
  await unlink(live).catch(() => {});
  await symlink(saved, live);
  console.log(`wrote ${saved}`);
} else {
  console.error("usage: bin/selfhost bin/routines.mjs [tick|install]");
  process.exit(2);
}
