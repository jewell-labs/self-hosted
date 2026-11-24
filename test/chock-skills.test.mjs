import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "../lib/discover.mjs";
import { CHOCK_SKILLS, chockUsage } from "../bin/chock-usage.mjs";

const SECRET = /BEGIN OPENSSH PRIVATE KEY|cfast_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const NAME = /^---\n[\s\S]*?^name:\s*([a-z0-9-]+)\s*$/m;

test("the production block set is twenty-two unchanged skills", async () => {
  assert.equal(CHOCK_SKILLS.length, 22);
  const root = repoRoot();
  for (const id of CHOCK_SKILLS) {
    const text = await readFile(join(root, ".agents", "skills", id, "SKILL.md"), "utf8");
    assert.equal(NAME.exec(text)?.[1], id);
    assert.equal(text.includes("disable-model-invocation"), false);
    assert.equal(SECRET.test(text), false);
  }
  const license = await readFile(join(root, ".agents", "skills", "chock-catalog.LICENSE"), "utf8");
  assert.match(license, /Apache License/);
  assert.equal(SECRET.test(license), false);
});

test("usage counts bytes and session mentions", async () => {
  const root = repoRoot();
  const dir = await mkdtemp(join(tmpdir(), "chock-usage-"));
  try {
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested", "session.jsonl"), "used protect-main-branch twice protect-main-branch\n");
    await writeFile(join(dir, "skip.bin"), "protect-main-branch");
    const report = await chockUsage(root, dir);
    assert.equal(report.status, "trial");
    assert.equal(report.worth, "undecided");
    assert.equal(report.files, 1);
    const main = report.skills.find((item) => item.id === "protect-main-branch");
    assert.equal(main.mentions, 2);
    assert.ok(main.bytes > 0);
    const idle = report.skills.find((item) => item.id === "scan-secrets");
    assert.equal(idle.mentions, 0);
    const sizes = await chockUsage(root);
    assert.equal(sizes.mentions, null);
    assert.equal(sizes.bytes, report.bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
