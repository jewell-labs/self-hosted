// Install the selected llama.cpp profile as a per-user LaunchAgent.
// Usage: SELFHOST_MODELS_DIR=/path/to/gguf node bin/install-darwin-llama.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { selectLlamaProfile } from "../lib/profiles.mjs";
import { readHost } from "../lib/host.mjs";

if (process.platform !== "darwin") {
  console.error("install-darwin-llama.mjs is for macOS");
  process.exit(2);
}
const modelsDir = process.env.SELFHOST_MODELS_DIR;
if (!modelsDir) {
  console.error("set SELFHOST_MODELS_DIR to the directory of GGUF files");
  process.exit(2);
}
const bin = process.env.LLAMA_SERVER ?? "/opt/homebrew/bin/llama-server";
const host = readHost();
const profile = selectLlamaProfile(host);
if (!profile) {
  console.error("no llama profile for this host");
  process.exit(1);
}
const args = [bin, ...profile.args, "--models-dir", modelsDir];
const home = homedir();
const label = "com.jewell-labs.llama-server";
const log = join(home, "Library/Logs/jewell-labs-llama-server.log");
const plistPath = join(home, "Library/LaunchAgents", `${label}.plist`);
mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
mkdirSync(join(home, "Library/Logs"), { recursive: true });
const xmlArgs = args.map((arg) => `    <string>${arg.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`).join("\n");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProgramArguments</key>
  <array>
${xmlArgs}
  </array>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
writeFileSync(plistPath, plist);
const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
const domain = `gui/${uid}`;
for (const old of ["com.dpi.llama-server", "com.dpi.llama-router", label]) {
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${old}`], { stdio: "ignore" });
  } catch {
    // not loaded
  }
}
rmSync(join(home, "Library/LaunchAgents/com.dpi.llama-server.plist"), { force: true });
rmSync(join(home, "Library/LaunchAgents/com.dpi.llama-router.plist"), { force: true });
rmSync(join(home, "Library/LaunchAgents/com.dpi.llama-router.plist.replaced"), { force: true });
execFileSync("launchctl", ["bootstrap", domain, plistPath]);
console.log(`installed ${label} profile=${profile.id} plist=${plistPath}`);
