// Record the llm server plist inside ~/.self-hosted/llm. This does not install a LaunchAgent.
// Weights stay in this plugin's library. The log stays in the llm folder.
// Usage: core/bin/selfhost core/bin/install-darwin-llama.mjs
import { join } from "node:path";
import { JailError, realInsideSync, writeSyncInside } from "../lib/jail.mjs";
import { llamaJob, renderPlist } from "../lib/services.mjs";
import { homeDir, layout, pluginDir } from "../lib/paths.mjs";

if (process.platform !== "darwin") {
  console.error("install-darwin-llama.mjs is for macOS");
  process.exit(2);
}
const root = homeDir();
const modelsDir = process.env.SELFHOST_LLM_MODELS ?? layout().llmModels;
try {
  realInsideSync(root, modelsDir);
} catch (error) {
  console.error(error instanceof JailError ? error.message : "models dir is outside the home");
  process.exit(1);
}
const job = llamaJob();
if (!job) {
  console.error("no llm profile for this host");
  process.exit(1);
}
const plist = renderPlist(job);
let plistPath;
try {
  plistPath = join(pluginDir("llm"), "launchd", "agents", `${job.label}.plist`);
  writeSyncInside(root, plistPath, plist);
} catch (error) {
  console.error(error instanceof JailError ? error.message : error.message);
  process.exit(1);
}
console.log(`recorded ${job.label} plist=${plistPath}`);
