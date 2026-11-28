import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/discover.mjs";
import { publishAgent } from "../lib/launchd.mjs";
import { renderPlist, routinesJob } from "../lib/services.mjs";

const command = process.argv[2] ?? "tick";
const root = repoRoot();

if (command === "tick") {
  const work = await import(pathToFileURL(join(root, "work/routines.mjs")).href);
  const live = await import(pathToFileURL(join(root, "evals/live.mjs")).href);
  const lines = [...await work.tick(), ...await live.tickLive()];
  console.log(lines.join("\n"));
} else if (command === "install") {
  const job = routinesJob({ ...process.env, SELFHOST_ROOT: root, SELFHOST_NODE: process.execPath });
  const saved = publishAgent(process.env, job.label, renderPlist(job));
  console.log(`wrote ${saved}`);
} else {
  console.error("usage: core/bin/selfhost core/bin/routines.mjs [tick|install]");
  process.exit(2);
}
