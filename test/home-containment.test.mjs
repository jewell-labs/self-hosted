import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, lstat, readlink, writeFile, chmod } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

function run(script, args, env) {
  return spawnSync(process.execPath, [join(repo, script), ...args], {
    env,
    encoding: "utf8",
  });
}

async function names(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

function baseEnv(home, root, extra = {}) {
  const env = { ...process.env };
  delete env.SELFHOST_STATE;
  delete env.SELFHOST_REPOS;
  delete env.GHREF_REF;
  return {
    ...env,
    HOME: home,
    SELFHOST_HOME: root,
    SELFHOST_DOCTOR_OFFLINE: "1",
    ...extra,
  };
}

async function securityStub(home) {
  const stub = join(home, "security");
  await writeFile(stub, "#!/bin/sh\nexit 44\n");
  await chmod(stub, 0o755);
  return stub;
}

function storesInside(report, root) {
  for (const key of ["home", "weights", "containers"]) {
    const path = report.stores[key];
    assert.equal(path === root || path.startsWith(`${root}/`), true, `${key} ${path}`);
  }
}

test("strict doctor fails on a real legacy store and passes after adopt moves it", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-contain-"));
  const root = join(home, ".self-hosted");
  const legacy = join(home, "Library/Application Support/com.apple.container");
  const stub = await securityStub(home);
  await mkdir(join(legacy, "images"), { recursive: true });
  await writeFile(join(legacy, "images/node.tar"), "image-bytes");
  const label = "com.jewell-labs.routines";
  const agents = join(home, "Library/LaunchAgents");
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, `${label}.plist`), `<plist><string>${root}/logs/routines.log</string></plist>\n`);
  const env = baseEnv(home, root, { SELFHOST_SECURITY: stub });
  let relocated;
  try {
    const before = run("bin/doctor.mjs", [], env);
    assert.notEqual(before.status, 0, before.stdout);
    const failed = JSON.parse(before.stdout);
    assert.equal(failed.ok, false);
    assert.equal(failed.findings.find((item) => item.id === "containers.home").detail, "outside");

    const moved = run("bin/adopt.mjs", [], env);
    assert.equal(moved.status, 0, moved.stderr);
    assert.equal(await readFile(join(root, "containers/images/node.tar"), "utf8"), "image-bytes");
    assert.equal((await lstat(legacy)).isSymbolicLink(), true);
    assert.equal(await readlink(legacy), join(root, "containers"));
    const recorded = JSON.parse(await readFile(join(root, "launchd/labels.json"), "utf8"));
    assert.equal(recorded.home, root);
    assert.equal(recorded.agents.includes(label), true);
    assert.match(await readFile(join(root, "launchd/agents", `${label}.plist`), "utf8"), new RegExp(root));

    const after = run("bin/doctor.mjs", [], env);
    assert.equal(after.status, 0, after.stdout + after.stderr);
    const passed = JSON.parse(after.stdout);
    assert.equal(passed.ok, true);
    storesInside(passed, root);
    assert.equal(passed.findings.find((item) => item.id === "containers.home").detail, "linked");

    relocated = await mkdtemp(join(tmpdir(), "selfhost-reloc-user-"));
    const copy = join(relocated, "relocated");
    await cp(root, copy, { recursive: true });
    const install = run("bin/adopt.mjs", ["--install-agents"], baseEnv(relocated, copy));
    assert.equal(install.status, 0, install.stderr);
    const plist = await readFile(join(relocated, "Library/LaunchAgents", `${label}.plist`), "utf8");
    assert.match(plist, new RegExp(copy));
    assert.equal(plist.includes(root), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    if (relocated) await rm(relocated, { recursive: true, force: true });
  }
});

test("a copied home reports the same stores on two discover and doctor runs", async () => {
  const user = await mkdtemp(join(tmpdir(), "selfhost-user-"));
  const prepared = join(user, "prepared");
  const copy = join(user, "copy");
  await mkdir(join(prepared, "models/gguf"), { recursive: true });
  await mkdir(join(prepared, "containers/images"), { recursive: true });
  await mkdir(join(prepared, "github/example/app"), { recursive: true });
  await writeFile(join(prepared, "models/gguf/weight.gguf"), "w");
  await writeFile(join(prepared, "containers/images/node.tar"), "c");
  await cp(prepared, copy, { recursive: true });
  const stub = await securityStub(user);
  const env = baseEnv(user, copy, {
    SELFHOST_SECURITY: stub,
    SELFHOST_REPOS: "example/app",
  });
  try {
    const runs = [];
    for (let i = 0; i < 2; i += 1) {
      const discovered = run("bin/discover.mjs", [], env);
      const checked = run("bin/doctor.mjs", [], env);
      assert.equal(discovered.status, 0, discovered.stderr);
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      const discovery = JSON.parse(discovered.stdout);
      const doctor = JSON.parse(checked.stdout);
      storesInside(discovery, copy);
      storesInside(doctor, copy);
      assert.equal(discovery.host.modelsDir, discovery.stores.weights);
      assert.equal(discovery.stores.containers.startsWith(`${copy}/`), true);
      assert.equal(doctor.findings.find((item) => item.id === "agents.example/app").detail, "no mcp.json");
      runs.push(`${discovered.stdout}\n${checked.stdout}`);
    }
    assert.equal(runs[0], runs[1]);
  } finally {
    await rm(user, { recursive: true, force: true });
  }
});

test("proof setup and check use a temporary home", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-proof-"));
  const root = join(home, ".self-hosted");
  const real = homedir();
  const before = {
    top: await names(real),
    hosted: await names(join(real, ".self-hosted")),
    agents: await names(join(real, "Library/LaunchAgents")),
  };
  const env = baseEnv(home, root);
  try {
    for (const id of ["baseline", "mcp"]) {
      const setup = run("bin/setup.mjs", [id], env);
      assert.equal(setup.status, 0, setup.stderr);
      const check = run("bin/check.mjs", [id], env);
      assert.equal(check.status, 0, check.stderr);
      assert.match(setup.stdout, new RegExp(join(root, "state")));
    }
    assert.equal((await readFile(join(root, "state/host.json"), "utf8")).includes("schema"), true);
    assert.equal((await readFile(join(root, "state/mcp.json"), "utf8")).includes("127.0.0.1"), true);
    assert.deepEqual({
      top: await names(real),
      hosted: await names(join(real, ".self-hosted")),
      agents: await names(join(real, "Library/LaunchAgents")),
    }, before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
