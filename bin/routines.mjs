import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { publishAgent } from "../lib/launchd.mjs";
import { layout } from "../lib/paths.mjs";
import { tick } from "../work/routines.mjs";

const command = process.argv[2] ?? "tick";
const root = repoRoot();

if (command === "tick") {
  const lines = await tick();
  console.log(lines.join("\n"));
} else if (command === "install") {
  const label = "com.jewell-labs.routines";
  const paths = layout();
  const log = join(paths.logs, "routines.log");
  await mkdir(paths.logs, { recursive: true });
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
  const saved = publishAgent(process.env, label, body);
  console.log(`wrote ${saved}`);
} else {
  console.error("usage: node bin/routines.mjs [tick|install]");
  process.exit(2);
}
