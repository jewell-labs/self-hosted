import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { layout } from "../core/lib/paths.mjs";

export async function setup(ctx) {
  const dir = layout().sshd;
  const unit = {
    listen: "127.0.0.1",
    port: "port {sshd}",
    passwordAuthentication: false,
    kbdInteractiveAuthentication: false,
    pubkeyAuthentication: true,
    hostKey: join(dir, "ssh_host_ed25519_key"),
    authorizedPrincipalsFile: join(dir, "authorized_principals"),
    trustedUserCAKeys: join(dir, "cf-access-ca.pub"),
    note: "The CA, host key, and principals stay in this directory. Do not commit them.",
  };
  const dest = await ctx.writeState("sshd.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "sshd.json"), "utf8"));
  const dir = layout().sshd;
  if (written.listen !== "127.0.0.1" || written.port !== "port {sshd}" || written.passwordAuthentication !== false) {
    console.error("sshd unit is not loopback, port {sshd}, passwords off");
    process.exit(1);
  }
  for (const key of ["hostKey", "authorizedPrincipalsFile", "trustedUserCAKeys"]) {
    if (!written[key].startsWith(`${dir}/`)) {
      console.error(`sshd ${key} is not under ${dir}`);
      process.exit(1);
    }
  }
  console.log("sshd ok");
}
