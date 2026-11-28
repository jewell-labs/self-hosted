import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import { listPackages, loadPackage, repoRootFromHere } from "../lib/lifecycle.mjs";
import { REQUIRED_FILES } from "../lib/plugins.mjs";

const root = repoRootFromHere();
const specRe = /(?:\bfrom|\bimport)\s*(?:\(\s*)?["'](\.[^"']+)["']/g;

function directPackages() {
  return readdirSync(root).filter((name) => !name.startsWith(".") && statSync(join(root, name)).isDirectory()).sort();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".mjs") || name.endsWith(".js")) out.push(path);
  }
  return out;
}

function allowed(packageId, target) {
  if (target.startsWith("../") || target === "..") return false;
  if (packageId === "core") return target.startsWith("core/");
  return target.startsWith(`${packageId}/`) || target.startsWith("core/");
}

test("shipped packages satisfy the isolation contract", () => {
  const ids = listPackages(root);
  assert.deepEqual(ids, directPackages());
  const rootFiles = readdirSync(root).filter((name) => statSync(join(root, name)).isFile()).sort();
  assert.deepEqual(rootFiles, ["AGENTS.md", "README.md"]);
  for (const id of ids) {
    for (const file of REQUIRED_FILES) {
      assert.equal(existsSync(join(root, id, file)), true, `${id} missing ${file}`);
    }
    const doc = loadPackage(root, id);
    assert.ok(doc.assets.length > 0, `${id} assets`);
    assert.ok(doc.assets.every((asset) => asset.path !== "setup.mjs" && asset.path !== "teardown.mjs"), `${id} asset is code`);
    const eventText = readFileSync(join(root, id, "event.json"), "utf8");
    assert.match(eventText, /"type": "healthcheck"/);
    assert.match(eventText, /"name": "healthcheck"/);
  }
  for (const file of walk(root)) {
    const rel = relative(root, file).split("\\").join("/");
    const packageId = rel.split("/")[0];
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(specRe)) {
      const resolved = relative(root, normalize(join(root, dirname(rel), match[1]))).split("\\").join("/");
      assert.equal(allowed(packageId, resolved), true, `${rel} depends on ${resolved}`);
    }
  }
  const home = mkdtempSync(join(tmpdir(), "selfhost-contract-"));
  const runtime = join(root, "core", "runtime");
  assert.equal(existsSync(runtime), true);
  try {
    for (const id of ids) {
      const payload = join(home, id, "assets", "payload");
      const sentinel = join(home, id, "keep.bin");
      const bytes = Buffer.from(`keep-${id}`);
      mkdirSync(join(home, id, "assets"), { recursive: true });
      writeFileSync(payload, bytes);
      writeFileSync(sentinel, bytes);
      const setup = spawnSync(process.execPath, [join(root, id, "setup.mjs")], {
        cwd: root,
        env: { ...process.env, SELFHOST_HOME: home, SELFHOST_ROOT: root },
        encoding: "utf8",
      });
      assert.equal(setup.status, 0, `${id} setup\n${setup.stdout}\n${setup.stderr}`);
      const started = JSON.parse(setup.stdout.trim().split("\n").pop());
      assert.equal(started.id, id);
      assert.equal(started.healthcheck, "ok");
      const logged = readFileSync(join(home, "logs", "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(logged.some((event) => event.plugin === id && event.type === "healthcheck" && event.name === "healthcheck" && event.detail === "ok"));
      assert.deepEqual(readFileSync(payload), bytes);
      const down = spawnSync(process.execPath, [join(root, id, "teardown.mjs")], {
        cwd: root,
        env: { ...process.env, SELFHOST_HOME: home, SELFHOST_ROOT: root },
        encoding: "utf8",
      });
      assert.equal(down.status, 0, `${id} teardown\n${down.stdout}\n${down.stderr}`);
      const ended = JSON.parse(down.stdout.trim().split("\n").pop());
      assert.equal(ended.id, id);
      assert.equal(ended.status, "down");
      assert.equal(ended.healthcheck, "down");
      assert.equal(existsSync(payload), true, `${id} asset removed`);
      assert.equal(existsSync(sentinel), true, `${id} sentinel removed`);
      assert.deepEqual(readFileSync(payload), bytes);
      assert.deepEqual(readFileSync(sentinel), bytes);
      assert.equal(existsSync(join(home, id, "run")), false, `${id} run state remains`);
    }
    assert.equal(existsSync(runtime), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  console.log(`plugins: ${ids.join(" ")}`);
});

test("core adds a plugin onto an existing install", () => {
  const home = mkdtempSync(join(tmpdir(), "selfhost-existing-"));
  const fixture = mkdtempSync(join(tmpdir(), "selfhost-fixture-"));
  const weight = join(home, "llm", "models", "keep.bin");
  try {
    mkdirSync(join(home, "llm", "models"), { recursive: true });
    writeFileSync(weight, "weights-stay");
    const result = spawnSync(process.execPath, [
      join(root, "core", "bin", "setup-existing.mjs"),
      "--home", home,
      "--root", fixture,
      "--add", "sample",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(parsed.id, "sample");
    assert.equal(parsed.healthcheck, "ok");
    assert.equal(readFileSync(weight, "utf8"), "weights-stay");
    const logged = readFileSync(join(home, "logs", "events.jsonl"), "utf8");
    assert.match(logged, /"plugin":"sample"/);
    assert.match(logged, /"type":"healthcheck"/);
    assert.match(logged, /"detail":"ok"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});
