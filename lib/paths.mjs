// Every self-hosted byte for this account lives under ~/.self-hosted.
// LaunchAgent plists are the exception: launchd only loads ~/Library/LaunchAgents.
import { homedir } from "node:os";
import { join } from "node:path";

// cloudflared-studio and com.dpi.llama-* are earlier labels. nuke still removes them.
// A new tunnel agent uses com.jewell-labs.cloudflared.
export const MANAGED_LABELS = Object.freeze([
  "com.jewell-labs.llama-server",
  "com.jewell-labs.cloudflared",
  "com.jewell-labs.cloudflared-studio",
  "com.jewell-labs.userland-sshd",
  "com.jewell-labs.routines",
  "local.ghref",
  "com.dpi.llama-server",
  "com.dpi.llama-router",
  "com.jewell-labs.harness-check",
]);

export function userHome(env = process.env) {
  return env.HOME ?? homedir();
}

export function homeDir(env = process.env) {
  return env.SELFHOST_HOME ?? join(userHome(env), ".self-hosted");
}

const PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

// Everything a plugin sets up lives in this one directory.
// cleanup.json names the paths inside it that nuke keeps.
export function pluginDir(id, env = process.env) {
  if (typeof id !== "string" || !PLUGIN_ID.test(id)) throw new Error(`plugin ${id ?? ""}`);
  return join(homeDir(env), id);
}

export function layout(env = process.env) {
  const root = homeDir(env);
  const user = userHome(env);
  // The llm plugin owns the one weight library. decision reads this same directory.
  const models = join(root, "llm", "models");
  const gguf = join(models, "gguf");
  return {
    root,
    models,
    gguf,
    llm: join(root, "llm"),
    llmModels: gguf,
    decision: join(root, "decision"),
    decisionModels: gguf,
    agentDesktop: join(root, "agent-desktop"),
    state: join(root, "state"),
    cloudflare: join(root, "cloudflare"),
    cloudflared: join(root, "cloudflare", "tunnel"),
    token: join(root, "cloudflare", "tunnel", "token"),
    serviceTokenId: join(root, "cloudflare", "access", "client-id"),
    serviceTokenSecret: join(root, "cloudflare", "access", "client-secret"),
    sshd: join(root, "sshd"),
    github: join(root, "github-repos", "github"),
    ghref: join(root, "github-repos", "ghref"),
    work: join(root, "work"),
    portless: join(root, "portless"),
    logs: join(root, "logs"),
    opt: join(root, "opt"),
    bin: join(root, "bin"),
    containers: join(root, "containers"),
    launchd: join(root, "launchd"),
    links: join(root, "launchd", "links.json"),
    labels: join(root, "launchd", "labels.json"),
    legacy: {
      models: join(user, "local", "models"),
      agentDesktop: join(user, ".agent-desktop"),
      cloudflared: join(user, ".cloudflared"),
      sshd: join(user, ".ssh", "userland"),
      github: join(user, "github"),
      ghref: join(user, ".local", "share", "ghref"),
      portless: join(user, ".portless"),
      state: join(user, ".local", "state", "self-hosted"),
      containers: join(user, "Library", "Application Support", "com.apple.container"),
    },
  };
}

// The containers plugin owns this directory.
// Apple's default ~/Library/Application Support/com.apple.container is not the store.
export function containerAppRoot(env = process.env) {
  return layout(env).containers;
}

export function containerEnv(env = process.env) {
  if (env.CONTAINER_APP_ROOT) return env;
  return { ...env, CONTAINER_APP_ROOT: containerAppRoot(env) };
}
