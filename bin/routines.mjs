import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { tick } from "../work/routines.mjs";

const command = process.argv[2] ?? "tick";
const root = repoRoot();

if (command === "tick") {
  const lines = await tick();
  console.log(lines.join("\n"));
} else if (command === "install") {
  const label = "com.jewell-labs.routines";
  const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const log = join(homedir(), ".self-hosted", "logs", "routines.log");
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await mkdir(join(homedir(), ".self-hosted", "logs"), { recursive: true });
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
  <key>StartInterval</key><integer>86400</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
  await writeFile(plist, body);
  console.log(`wrote ${plist}`);
} else {
  console.error("usage: node bin/routines.mjs [tick|install]");
  process.exit(2);
}
