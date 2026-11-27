import { repoRoot } from "../lib/discover.mjs";
import { publishAgent } from "../lib/launchd.mjs";
import { renderPlist, routinesJob } from "../lib/services.mjs";
import { tickLive } from "../evals/live.mjs";
import { tick } from "../work/routines.mjs";

const command = process.argv[2] ?? "tick";
const root = repoRoot();

if (command === "tick") {
  const lines = [...await tick(), ...await tickLive()];
  console.log(lines.join("\n"));
} else if (command === "install") {
  const job = routinesJob({ ...process.env, SELFHOST_ROOT: root, SELFHOST_NODE: process.execPath });
  const saved = publishAgent(process.env, job.label, renderPlist(job));
  console.log(`wrote ${saved}`);
} else {
  console.error("usage: bin/selfhost bin/routines.mjs [tick|install]");
  process.exit(2);
}
