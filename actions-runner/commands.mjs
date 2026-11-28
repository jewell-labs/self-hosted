export async function setup(ctx) {
  if (!ctx.plugin.publicRunnerAllowed) {
    console.error("refusing actions-runner: this repository is public. Set ALLOW_PUBLIC_REPO_RUNNER=1 only if you accept pull-request code on this host.");
    process.exit(1);
  }
  await ctx.writeState("actions-runner.json", `${JSON.stringify({ allowed: true, host: ctx.host.hostname }, null, 2)}\n`);
  console.log("actions-runner override recorded");
}

export async function check(ctx) {
  if (!ctx.plugin.publicRunnerAllowed) {
    console.error("actions-runner remains refused on a public repo");
    process.exit(1);
  }
  console.log("actions-runner ok");
}
