import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activateAgent } from "../lib/launchd.mjs";
import {
  assertNoSecret,
  containerArgv,
  guestJob,
  renderPlist,
  renderSystemd,
  tunnelJob,
} from "../lib/services.mjs";

const secret = "super-secret-token-value";

test("tunnel plist points at the script and does not carry the token", () => {
  const job = tunnelJob({ SELFHOST_ROOT: "/repo", HOME: "/Users/example", SELFHOST_HOME: "/Users/example/.self-hosted" });
  const plist = renderPlist(job);
  const unit = renderSystemd(job);
  assert.equal(job.program[0], "/bin/sh");
  assert.equal(job.program[1], "/repo/cloudflare/run-tunnel.sh");
  assert.equal(job.program.includes(secret), false);
  assert.equal(plist.includes("token-file"), false);
  assert.equal(plist.includes(secret), false);
  assert.match(unit, /Restart=on-failure/);
  assert.doesNotThrow(() => assertNoSecret(plist + unit, secret));
  assert.throws(() => assertNoSecret(`${plist}\n${secret}`, secret), /secret/);
  assert.throws(() => containerArgv(job), /does not run in a container/);
});

test("guest argv is the harness check", () => {
  const job = guestJob({}, "/self-hosted");
  assert.deepEqual(containerArgv(job), ["/bin/sh", "/self-hosted/core/bin/selfhost", "core/bin/doctor.mjs", "shape"]);
  const plist = renderPlist(job);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
});

test("plutil accepts a rendered plist and activate replaces a symlink", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-services-"));
  const root = join(home, ".self-hosted");
  try {
    const job = guestJob({ SELFHOST_NODE: "/usr/bin/node" }, "/self-hosted");
    const body = renderPlist(job);
    const plist = join(home, "job.plist");
    await writeFile(plist, body);
    const lint = spawnSync("plutil", ["-lint", plist], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stderr);

    const agents = join(home, "Library/LaunchAgents");
    await mkdir(agents, { recursive: true });
    const live = join(agents, `${job.label}.plist`);
    const elsewhere = join(home, "elsewhere.plist");
    await writeFile(elsewhere, "old");
    await symlink(elsewhere, live);
    const log = join(home, "launchctl.log");
    const fake = join(home, "launchctl");
    await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' \"$*\" >> '${log}'\nexit 0\n`);
    await chmod(fake, 0o755);
    const plutil = join(home, "plutil");
    await writeFile(plutil, "#!/bin/sh\nexit 0\n");
    await chmod(plutil, 0o755);
    activateAgent(
      { ...process.env, HOME: home, SELFHOST_HOME: root, SELFHOST_LAUNCHCTL_LOG: log },
      job.label,
      body,
      { domain: "gui/501", launchctl: fake, plutil },
    );
    const stat = await lstat(live);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o777, 0o644);
    const calls = await readFile(log, "utf8");
    assert.match(calls, /enable gui\/501\/com.jewell-labs.harness-check/);
    assert.match(calls, /bootout gui\/501\/com.jewell-labs.harness-check/);
    assert.match(calls, new RegExp(`bootstrap gui/501 ${live.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
