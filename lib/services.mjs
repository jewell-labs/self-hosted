// One description of each supervised job.
// Darwin, systemd, and a container entrypoint all render this list.
// The tunnel token is read by the script. It is never an argument.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHost } from "./host.mjs";
import { layout, pluginDir } from "./paths.mjs";
import { selectLlmProfile } from "./profiles.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

export function repoRoot(env = process.env) {
  return env.SELFHOST_ROOT ?? repo;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function systemdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderPlist(job) {
  const args = job.program.map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
  const env = job.environment ?? {};
  const envKeys = Object.keys(env);
  const environment = envKeys.length === 0 ? "" : `  <key>EnvironmentVariables</key>
  <dict>
${envKeys.map((key) => `    <key>${xml(key)}</key>\n    <string>${xml(env[key])}</string>`).join("\n")}
  </dict>
`;
  const keepalive = job.restart === "always"
    ? `  <key>KeepAlive</key>
  <true/>
`
    : job.restart === "on-failure"
      ? `  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
`
      : "";
  const interval = job.interval ? `  <key>StartInterval</key>
  <integer>${job.interval}</integer>
` : "";
  const stdout = job.stdout ? `  <key>StandardOutPath</key>
  <string>${xml(job.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(job.stderr ?? job.stdout)}</string>
` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(job.label)}</string>
  <key>RunAtLoad</key>
  <${job.runAtLoad === false ? "false" : "true"}/>
${keepalive}${environment}${interval}  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${stdout}</dict>
</plist>
`;
}

export function renderSystemd(job) {
  const restart = job.interval ? "" : `Restart=${job.restart === "always" ? "always" : "on-failure"}\n`;
  const env = Object.entries(job.environment ?? {}).map(([key, value]) => `Environment=${systemdArg(`${key}=${value}`)}\n`).join("");
  const logs = job.stdout ? `StandardOutput=append:${job.stdout}\nStandardError=append:${job.stderr ?? job.stdout}\n` : "";
  return `[Unit]
Description=${job.label}

[Service]
Type=${job.interval ? "oneshot" : "simple"}
ExecStart=${job.program.map(systemdArg).join(" ")}
${restart}${env}${logs}
[Install]
WantedBy=default.target
`;
}

// A regular Apple container has no service manager. The guest command is PID 1.
export function containerArgv(job) {
  if (job.where === "host") throw new Error(`${job.label} does not run in a container`);
  return [...job.program];
}

export function assertNoSecret(text, secret) {
  if (typeof secret === "string" && secret.length >= 8 && text.includes(secret)) {
    throw new Error("rendered service contains a secret");
  }
}

// The studio tunnel publishes llama on 127.0.0.1:8080. The port stays fixed.
export function llamaJob(env = process.env) {
  const host = readHost(env);
  const profile = selectLlmProfile(host);
  if (!profile) return null;
  const modelsDir = env.SELFHOST_LLM_MODELS ?? layout(env).llmModels;
  const bin = env.LLAMA_SERVER ?? "/opt/homebrew/bin/llama-server";
  const port = env.SELFHOST_LLM_PORT ?? "8080";
  const args = profile.args.map((arg) => (arg === "{{port}}" ? port : arg));
  const log = join(pluginDir("llm", env), "logs", "jewell-labs-llama-server.log");
  return {
    label: "com.jewell-labs.llama-server",
    where: "host",
    restart: "always",
    runAtLoad: true,
    program: [bin, ...args, "--models-dir", modelsDir],
    stdout: log,
    stderr: log,
  };
}

export function tunnelJob(env = process.env) {
  const log = join(layout(env).cloudflared, "cloudflared.log");
  return {
    label: "com.jewell-labs.cloudflared-studio",
    where: "host",
    restart: "on-failure",
    runAtLoad: true,
    program: ["/bin/sh", join(repoRoot(env), "plugins/cloudflare/run-tunnel.sh")],
    environment: { CLOUDFLARED_BIN: env.CLOUDFLARED_BIN ?? "/opt/homebrew/bin/cloudflared" },
    stdout: log,
    stderr: log,
  };
}

export function sshdJob(env = process.env) {
  const dir = layout(env).sshd;
  const log = join(dir, "sshd.log");
  return {
    label: "com.jewell-labs.userland-sshd",
    where: "host",
    restart: "always",
    runAtLoad: true,
    program: ["/usr/sbin/sshd", "-f", join(dir, "sshd_config"), "-D"],
    stdout: log,
    stderr: log,
  };
}

// The running studio agent ticks once a day. A missing token must not apply here.
function launcher(root) {
  return ["/bin/sh", join(root, "bin/selfhost")];
}

export function routinesJob(env = process.env) {
  const log = join(layout(env).logs, "routines.log");
  return {
    label: "com.jewell-labs.routines",
    where: "host",
    restart: "interval",
    interval: 86400,
    runAtLoad: true,
    program: [...launcher(repoRoot(env)), "bin/routines.mjs", "tick"],
    stdout: log,
    stderr: log,
  };
}

export function guestJob(env = process.env, root = "/self-hosted") {
  return {
    label: "com.jewell-labs.harness-check",
    where: "guest",
    restart: "on-failure",
    runAtLoad: true,
    program: [...launcher(root), "bin/doctor.mjs", "shape"],
  };
}

export function hostJobs(env = process.env) {
  // Tunnel and sshd first so a later job cannot leave the host unreachable.
  return [tunnelJob(env), sshdJob(env), routinesJob(env), llamaJob(env)].filter(Boolean);
}
