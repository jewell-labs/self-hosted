// Install the host jobs from lib/services.mjs.
// Usage: core/bin/selfhost core/bin/services.mjs install
//        core/bin/selfhost core/bin/services.mjs print
//        core/bin/selfhost core/bin/services.mjs guest
import { existsSync } from "node:fs";
import { activateAgent } from "../lib/launchd.mjs";
import { containerArgv, guestJob, hostJobs, renderPlist, renderSystemd } from "../lib/services.mjs";

const command = process.argv[2] ?? "print";

function installEnv() {
  const env = { ...process.env };
  if (!env.SELFHOST_NODE && existsSync("/opt/homebrew/bin/node")) env.SELFHOST_NODE = "/opt/homebrew/bin/node";
  return env;
}

if (command === "install") {
  if (process.platform !== "darwin") {
    console.error("services install is for macOS");
    process.exit(2);
  }
  const env = installEnv();
  const domain = env.SELFHOST_LAUNCHD_DOMAIN;
  for (const job of hostJobs(env)) {
    const written = activateAgent(env, job.label, renderPlist(job), domain ? { domain } : {});
    console.log(`bootstrapped ${job.label} ${written.dest}`);
  }
} else if (command === "print") {
  for (const job of hostJobs()) {
    process.stdout.write(`# ${job.label}\n${renderPlist(job)}\n# systemd\n${renderSystemd(job)}\n`);
  }
} else if (command === "guest") {
  const job = guestJob(process.env, process.env.SELFHOST_GUEST_ROOT ?? "/self-hosted");
  process.stdout.write(`${JSON.stringify(containerArgv(job))}\n`);
} else {
  console.error("usage: core/bin/selfhost core/bin/services.mjs [install|print|guest]");
  process.exit(2);
}
