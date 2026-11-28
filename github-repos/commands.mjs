import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function setup(ctx) {
  const printed = execFileSync("bash", ["github-repos/ghref", "print-config"], { cwd: ctx.root, encoding: "utf8" });
  const lines = printed.trim().split("\n");
  const intervalLine = lines[0] ?? "";
  if (!intervalLine.startsWith("interval_seconds=")) {
    console.error("github-repos config did not print an interval");
    process.exit(1);
  }
  const unit = {
    intervalSeconds: Number(intervalLine.slice("interval_seconds=".length)),
    repos: lines.slice(1),
    config: "github-repos/config",
  };
  const dest = await ctx.writeState("github-repos.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} every ${unit.intervalSeconds}s`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "github-repos.json"), "utf8"));
  const script = readFileSync(join(ctx.root, "github-repos/ghref"), "utf8");
  const config = readFileSync(join(ctx.root, "github-repos/config"), "utf8");
  if (script.includes("REPOS=") || /integer>\d+<\/integer>/.test(script) || /\b900\b/.test(script)) {
    console.error("ghref hardcodes a repo list or interval; those belong in github-repos/config");
    process.exit(1);
  }
  const interval = Number((config.match(/^interval_seconds=(\d+)$/m) ?? [])[1]);
  const repos = config.split("\n").filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("interval_seconds="));
  const printed = execFileSync("bash", ["github-repos/ghref", "print-config"], { cwd: ctx.root, encoding: "utf8" }).trim().split("\n");
  if (written.intervalSeconds !== interval || printed[0] !== `interval_seconds=${interval}`) {
    console.error("recorded interval does not match github-repos/config");
    process.exit(1);
  }
  if (written.repos.join("\n") !== repos.join("\n") || printed.slice(1).join("\n") !== repos.join("\n")) {
    console.error("recorded repos do not match github-repos/config");
    process.exit(1);
  }
  console.log(`github-repos ok every ${interval}s`);
}
