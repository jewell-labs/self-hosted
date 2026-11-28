import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { due } from "../lib/schedule.mjs";
import { hostJobs } from "../lib/services.mjs";
import { containerAppRoot } from "../lib/paths.mjs";
import { repoRootFromHere } from "../lib/lifecycle.mjs";

const repo = repoRootFromHere();

test("due accepts the routine intervals", () => {
  assert.equal(due("1d", undefined, 0), true);
  assert.equal(due("1d", new Date(0).toISOString(), 1000), false);
  assert.equal(due("1h", new Date(0).toISOString(), 60 * 60 * 1000), true);
  assert.throws(() => due("nope", undefined, 0), /unknown every/);
});

test("hostJobs keeps the routines job on the core launcher", () => {
  const jobs = hostJobs({
    SELFHOST_ROOT: "/repo",
    HOME: "/Users/studio",
    SELFHOST_HOME: "/Users/studio/.self-hosted",
  });
  assert.deepEqual(jobs.map((job) => job.label), [
    "com.jewell-labs.cloudflared-studio",
    "com.jewell-labs.userland-sshd",
    "com.jewell-labs.routines",
    "com.jewell-labs.llama-server",
  ]);
  const routines = jobs.find((job) => job.label === "com.jewell-labs.routines");
  assert.deepEqual(routines.program, ["/bin/sh", "/repo/core/bin/selfhost", "core/bin/routines.mjs", "tick"]);
  assert.equal(routines.interval, 86400);
  assert.equal(routines.where, "host");
});

test("workClean removes an old work dir and leaves an asset in place", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-clean-"));
  const work = join(home, "work");
  const oldDir = join(work, "old-one");
  const youngDir = join(work, "young-one");
  const asset = join(home, "asset.bin");
  try {
    await mkdir(oldDir, { recursive: true });
    await mkdir(youngDir, { recursive: true });
    await writeFile(asset, "stay");
    const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(join(oldDir, "meta.json"), JSON.stringify({ createdAt: oldAt, project: "a/b" }));
    await writeFile(join(youngDir, "meta.json"), JSON.stringify({ createdAt: new Date().toISOString() }));
    const { workClean } = await import(pathToFileURL(join(repo, "work/tools.mjs")).href);
    const result = await workClean({ ...process.env, SELFHOST_WORK_ROOT: work });
    assert.equal(result.isError, false, result.text);
    const body = JSON.parse(result.text);
    assert.equal(body.removed.includes(oldDir), true);
    assert.equal(body.kept.some((item) => item.dir === youngDir && item.reason === "young"), true);
    assert.equal(existsSync(oldDir), false);
    assert.equal(existsSync(youngDir), true);
    assert.equal(await readFile(asset, "utf8"), "stay");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("evalsRun dispatches the container eval through core/bin/selfhost", async () => {
  const calls = [];
  const execFile = async (bin, args, opts) => {
    calls.push({ bin, args, env: opts?.env });
    if (bin === "which") return { stdout: "/opt/homebrew/bin/container\n", stderr: "" };
    if (args.at(-1) === "evals/cli.mjs") {
      return { stdout: `${JSON.stringify({ results: [{ id: "llm-hierarchy", detail: "ok", body: "ok" }] })}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const env = {
    ...process.env,
    SELFHOST_ROOT: repo,
    LLM_URL: "",
    LLAMA_URL: "",
    SELFHOST_LLM_URL: "",
    SELFHOST_DECISION_URL: "",
    LLM_MODEL: "",
    LLAMA_MODEL: "",
  };
  const { evalsRun } = await import(pathToFileURL(join(repo, "evals/tools.mjs")).href);
  const result = await evalsRun({ id: "llm-hierarchy", model: "granite-test" }, env, { execFile });
  assert.equal(result.isError, false, result.text);
  const body = JSON.parse(result.text);
  assert.equal(body.isolated, true);
  assert.deepEqual(body.results, [{ id: "llm-hierarchy", detail: "ok", body: "ok" }]);
  const launched = calls.find((call) => call.args.at(-1) === "evals/cli.mjs");
  assert.ok(launched);
  assert.equal(launched.args.at(-2), "core/bin/selfhost");
  const store = containerAppRoot(env);
  assert.equal(launched.env.CONTAINER_APP_ROOT, store);
  assert.equal(store.includes("com.apple.container"), false);
  assert.equal(store.endsWith("/.self-hosted/containers"), true);
});
