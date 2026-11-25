import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { layout } from "../../lib/paths.mjs";
import { accessConfig } from "./access.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function loadPolicy() {
  return JSON.parse(readFileSync(join(here, "policy.json"), "utf8"));
}

export function cloudflareUnit(env = process.env) {
  const policy = loadPolicy();
  const access = accessConfig(env);
  const paths = layout(env);
  return {
    tunnel: {
      tokenPath: paths.token,
      command: ["plugins/cloudflare/run-tunnel.sh"],
      mode: "0600",
    },
    access: {
      required: access.required,
      assertionHeader: policy.access.assertionHeader,
      jwksTtlMinutes: 10,
      destructiveNeedsJwt: true,
      teamConfigured: access.teamDomain !== "",
      audienceConfigured: access.aud !== "",
      sshCa: join(paths.sshd, "cf-access-ca.pub"),
    },
    auth: {
      mechanism: "cloudflare-access-service-token",
      oneSharedServiceToken: policy.access.oneSharedServiceToken === true,
      headers: policy.access.headers,
      idFile: paths.serviceTokenId,
      secretFile: paths.serviceTokenSecret,
    },
    limits: policy.access,
    logs: {
      worker: "plugins/cloudflare/worker.mjs",
      className: "LogStream",
      binding: "LOGS",
      instance: "host",
      storage: "sqlite",
      audience: "CF_ACCESS_AUD",
      publish: "SELFHOST_LOG_URL",
    },
    admin: {
      mechanism: "macos-keychain",
      service: "cloudflare",
      account: "default",
      update: "cloudflare-token",
      call: "cloudflare-api",
    },
  };
}
