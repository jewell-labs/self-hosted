import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("justfile is the command list", async () => {
  const text = await readFile(join(repo, "justfile"), "utf8");
  for (const name of ["discover:", "test:", "doctor level", "flake:", "setup id:", "check id:", "repos:", "explore:", "sync:", "prove:", "nuke:", "nuke-all:", "adopt:", "cloudflare-token:", "cloudflare-api method"]) {
    assert.match(text, new RegExp(`^${name}`, "m"));
  }
});

test("explore prints the work tree and a missing mirror without fetching", async () => {
  const store = await mkdtemp(join(tmpdir(), "explore-"));
  const present = join(store, "example", "app");
  await mkdir(present, { recursive: true });
  await writeFile(join(present, "README.md"), "app\n");
  const run = spawnSync(process.execPath, [join(repo, "bin/explore.mjs")], {
    cwd: repo,
    env: { ...process.env, GHREF_REF: store, SELFHOST_REPOS: "example/app,example/missing" },
    encoding: "utf8",
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^work\n/m);
    assert.match(run.stdout, /mirror example\/app\n {2}path/);
    assert.match(run.stdout, /mirror example\/missing\n {2}absent/);
    assert.doesNotMatch(run.stdout, /fetch/);
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("doctor shape exits 0 from the cli", () => {
  const run = spawnSync(process.execPath, [join(repo, "bin/doctor.mjs"), "shape"], {
    cwd: repo,
    env: { ...process.env, SELFHOST_DOCTOR_OFFLINE: "1", SELFHOST_REPOS: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /"level": "shape"/);
});
