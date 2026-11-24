// Every self-hosted byte for this account lives under ~/.self-hosted.
// LaunchAgent plists are the exception: launchd only loads ~/Library/LaunchAgents.
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// just nuke keeps these. models is the GGUF library. containers is the Apple
// container image and kernel store. agent-desktop is the macOS sandbox.
// llm and decision are the two server homes and stay with the weights.
export const KEEP = Object.freeze(["models", "llm", "decision", "containers", "agent-desktop"]);

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
]);

export function userHome(env = process.env) {
  return env.HOME ?? homedir();
}

export function homeDir(env = process.env) {
  return env.SELFHOST_HOME ?? join(userHome(env), ".self-hosted");
}

export function layout(env = process.env) {
  const root = homeDir(env);
  const user = userHome(env);
  // One weight library. llm and decision are separate processes and both read this directory.
  const gguf = join(root, "models", "gguf");
  return {
    root,
    models: join(root, "models"),
    gguf,
    llm: join(root, "llm"),
    llmModels: gguf,
    decision: join(root, "decision"),
    decisionModels: gguf,
    agentDesktop: join(root, "agent-desktop"),
    state: join(root, "state"),
    cloudflared: join(root, "cloudflared"),
    token: join(root, "cloudflared", "token"),
    cloudflare: join(root, "cloudflare"),
    serviceTokenId: join(root, "cloudflare", "access", "client-id"),
    serviceTokenSecret: join(root, "cloudflare", "access", "client-secret"),
    sshd: join(root, "sshd"),
    github: join(root, "github"),
    ghref: join(root, "ghref"),
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

function realDirectory(stat) {
  return Boolean(stat && stat.isDirectory() && !stat.isSymbolicLink());
}

// Empty until `just adopt` moves a real Apple container directory into the home.
// A symlink, or no directory, means new images go to ~/.self-hosted/containers.
export function containerAppRoot(env = process.env, stat = lstatSync) {
  const paths = layout(env);
  try {
    if (realDirectory(stat(paths.legacy.containers))) return "";
  } catch {
    // The Apple directory is not there yet.
  }
  return paths.containers;
}

export function containerEnv(env = process.env, stat = lstatSync) {
  if (env.CONTAINER_APP_ROOT) return env;
  const root = containerAppRoot(env, stat);
  if (!root) return env;
  return { ...env, CONTAINER_APP_ROOT: root };
}
