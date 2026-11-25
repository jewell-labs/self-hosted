// Record the llm server plist inside ~/.self-hosted/llm. This does not install a LaunchAgent.
// Weights stay in the shared library. The log stays in the llm folder.
// Usage: bin/selfhost bin/install-darwin-llama.mjs
import { join } from "node:path";
import { JailError, realInsideSync, writeSyncInside } from "../lib/jail.mjs";
import { selectLlmProfile } from "../lib/profiles.mjs";
import { readHost } from "../lib/host.mjs";
import { homeDir, layout, pluginDir } from "../lib/paths.mjs";

if (process.platform !== "darwin") {
  console.error("install-darwin-llama.mjs is for macOS");
  process.exit(2);
}
const root = homeDir();
const modelsDir = process.env.SELFHOST_LLM_MODELS ?? layout().llmModels;
const bin = process.env.LLAMA_SERVER ?? "/opt/homebrew/bin/llama-server";
const host = readHost();
const profile = selectLlmProfile(host);
if (!profile) {
  console.error("no llm profile for this host");
  process.exit(1);
}
try {
  realInsideSync(root, modelsDir);
} catch (error) {
  console.error(error instanceof JailError ? error.message : "models dir is outside the home");
  process.exit(1);
}
const rendered = profile.args.map((arg) => (arg === "{{port}}" ? '"$PORT"' : `'${String(arg).replaceAll("'", "'\\''")}'`));
const command = `exec '${String(bin).replaceAll("'", "'\\''")}' ${rendered.join(" ")} --models-dir '${String(modelsDir).replaceAll("'", "'\\''")}'`;
const args = [process.env.PORTLESS ?? "portless", profile.port, "--", "/bin/sh", "-c", command];
const label = "com.jewell-labs.llama-server";
const log = join(pluginDir("llm"), "logs", "jewell-labs-llama-server.log");
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
let plistPath;
try {
  plistPath = join(pluginDir("llm"), "launchd", "agents", `${label}.plist`);
  writeSyncInside(root, plistPath, plist);
} catch (error) {
  console.error(error instanceof JailError ? error.message : error.message);
  process.exit(1);
}
console.log(`recorded ${label} profile=${profile.id} plist=${plistPath}`);
