import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscovery } from "../lib/discover.mjs";
import { selectLlamaProfile } from "../lib/profiles.mjs";

test("mac studio 32GB selects the metal throughput profile", () => {
  const profile = selectLlamaProfile({ os: "darwin", arch: "arm64", memGb: 32, cpus: 10, nvidia: false });
  assert.equal(profile.id, "mac-studio-m1-max-32gb");
  assert.ok(profile.args.includes("q8_0"));
  assert.ok(profile.args.includes("0-7"));
  assert.equal(profile.args.filter((part) => part === "1").length >= 1, true);
  assert.equal(profile.args.includes("--parallel") && profile.args[profile.args.indexOf("--parallel") + 1], "1");
});

test("linux without nvidia uses the cpu profile and fills thread count", () => {
  const profile = selectLlamaProfile({ os: "linux", arch: "arm64", memGb: 8, cpus: 4, nvidia: false });
  assert.equal(profile.id, "linux-cpu");
  assert.equal(profile.args[profile.args.indexOf("--threads") + 1], "4");
  assert.equal(profile.args[profile.args.indexOf("--n-gpu-layers") + 1], "0");
});

test("jetson-style host uses cuda only when asked", () => {
  const host = { os: "linux", arch: "arm64", memGb: 16, cpus: 6, nvidia: true };
  assert.equal(selectLlamaProfile(host).id, "linux-cuda");
});

test("discover includes the setup prompt and marks proof plugins", () => {
  const discovery = buildDiscovery({ ...process.env, ALLOW_PUBLIC_REPO_RUNNER: "" });
  assert.equal(discovery.schema, "jewell-labs.self-hosted.discover.v1");
  assert.match(discovery.setupPrompt, /setup-host/);
  assert.equal(discovery.setupPromptSha256.length, 64);
  const proof = discovery.plugins.filter((plugin) => plugin.proofRequired && plugin.applicable).map((plugin) => plugin.id);
  assert.deepEqual(proof, ["baseline", "mcp"]);
  const runner = discovery.plugins.find((plugin) => plugin.id === "actions-runner");
  assert.equal(runner.publicRunnerAllowed, false);
  for (const id of ["agent-desktop", "agent-browser", "github-repos"]) {
    const plugin = discovery.plugins.find((item) => item.id === id);
    assert.equal(plugin.proofRequired, false);
    assert.match(plugin.setup[0], new RegExp(`^nix run \\.#setup-${id}$`));
  }
  assert.equal(discovery.plugins.find((plugin) => plugin.id === "decision").secondProcess, discovery.host.memGb >= 64);
});
