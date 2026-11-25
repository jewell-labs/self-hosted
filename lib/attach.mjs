// One home mount for an Apple container or a macOS sandbox share.
// A filter drops models or skills for one arm. Weight files stay in models/gguf.
// A macOS share hardlinks those files, so the guest sees the same inode.
import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { realInsideSync, loadHomePolicy } from "./jail.mjs";
import { weightFile } from "./models.mjs";
import { layout } from "./paths.mjs";

export const ATTACH_SCHEMA = "jewell-labs.self-hosted.attach.v1";
export const CONTAINER_HOME = "/self-hosted";
export const MACOS_HOME = "/Volumes/My Shared Files/self-hosted";

// Guest disks, this view, and credential stores stay out unless a filter adds them.
export const DEFAULT_OMIT = Object.freeze([
  "agent-desktop",
  "attach",
  "cloudflare",
  "cloudflared",
  "containers",
  "sshd",
]);

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SKILL_RE = /^[a-z0-9-]+$/;
const DIR_RE = /^[a-z0-9-]+$/;

export class AttachError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttachError";
  }
}

function guestJoin(root, rel) {
  const tail = String(rel).split(sep).filter(Boolean).join("/");
  return tail ? `${root}/${tail}` : root;
}

function names(value, pattern, label) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new AttachError(label);
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !pattern.test(item) || out.includes(item)) throw new AttachError(label);
    out.push(item);
  }
  return out.sort();
}

function modelNames(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new AttachError("model");
  const out = [];
  for (const item of value) {
    const file = weightFile(item);
    if (out.includes(file)) throw new AttachError("model");
    out.push(file);
  }
  return out.sort();
}

export function attachDigest(spec) {
  const body = JSON.stringify({
    write: spec.write === true,
    include: [...spec.include].sort(),
    models: spec.models === null ? null : [...spec.models].sort(),
    skills: spec.skills === null ? null : [...spec.skills].sort(),
  });
  return createHash("sha256").update(body).digest("hex");
}

async function skillRoots(home, include) {
  const candidates = [];
  if (include.includes("opt")) candidates.push(join(home, "opt", "self-hosted", ".agents", "skills"));
  if (include.includes("work")) {
    let kids = [];
    try {
      kids = await readdir(join(home, "work"), { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const kid of kids) {
      if (!kid.isDirectory() || kid.isSymbolicLink()) continue;
      candidates.push(join(home, "work", kid.name, ".agents", "skills"));
    }
  }
  const roots = [];
  for (const dir of candidates) {
    try {
      const st = await lstat(dir);
      if (st.isDirectory() && !st.isSymbolicLink()) roots.push(dir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return roots;
}

function pushMount(mounts, source, target, readonly) {
  if (source.includes(",") || source.includes("\n") || target.includes(",") || target.includes("\n")) {
    throw new AttachError("mount");
  }
  mounts.push({ source, target, readonly });
}

export async function attachPlan(env, input = {}) {
  const name = input.name ?? "arm";
  if (!NAME_RE.test(name)) throw new AttachError("name");
  const policy = await loadHomePolicy(input.repoRoot);
  const known = new Set(policy.allowed);
  const extra = names(input.include, DIR_RE, "include") ?? [];
  const dropped = names(input.exclude, DIR_RE, "exclude") ?? [];
  for (const item of [...extra, ...dropped]) {
    if (!known.has(item) || item === "attach") throw new AttachError("include");
  }
  if (extra.some((item) => dropped.includes(item))) throw new AttachError("include");
  const include = policy.allowed
    .filter((item) => !DEFAULT_OMIT.includes(item) || extra.includes(item))
    .filter((item) => !dropped.includes(item) && item !== "attach")
    .sort();
  const models = modelNames(input.models);
  const skills = names(input.skills, SKILL_RE, "skill");
  if (models && !include.includes("models")) throw new AttachError("models");
  const paths = layout(env);
  const home = paths.root;
  const mounts = [];
  const view = join(home, "attach", name);
  pushMount(mounts, join(view, "root"), CONTAINER_HOME, true);
  for (const item of include) {
    let st;
    try {
      st = await lstat(join(home, item));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    pushMount(mounts, join(home, item), guestJoin(CONTAINER_HOME, item), item === "models" ? true : input.write !== true);
  }
  if (models !== null) {
    const gguf = join(home, "models", "gguf");
    for (const file of models) {
      let st;
      try {
        st = await lstat(join(gguf, file));
      } catch (error) {
        if (error.code === "ENOENT") throw new AttachError(`missing model ${file}`);
        throw error;
      }
      if (!st.isFile() || st.isSymbolicLink()) throw new AttachError(`missing model ${file}`);
    }
    pushMount(mounts, join(view, "empty-gguf"), guestJoin(CONTAINER_HOME, join("models", "gguf")), true);
    for (const file of models) {
      pushMount(mounts, join(gguf, file), guestJoin(CONTAINER_HOME, join("models", "gguf", file)), true);
    }
  }
  if (skills !== null) {
    const roots = await skillRoots(home, include);
    const found = new Set();
    for (const root of roots) {
      pushMount(mounts, join(view, "empty-skills"), guestJoin(CONTAINER_HOME, relative(home, root)), true);
      for (const skill of skills) {
        const dir = join(root, skill);
        try {
          const st = await lstat(dir);
          if (!st.isDirectory() || st.isSymbolicLink()) continue;
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        found.add(skill);
        pushMount(mounts, dir, guestJoin(CONTAINER_HOME, relative(home, dir)), true);
      }
    }
    for (const skill of skills) {
      if (!found.has(skill)) throw new AttachError(`missing skill ${skill}`);
    }
  }
  const spec = { write: input.write === true, include, models, skills };
  const digest = attachDigest(spec);
  const envGuest = {
    SELFHOST_HOME: CONTAINER_HOME,
    SELFHOST_MODELS_DIR: guestJoin(CONTAINER_HOME, join("models", "gguf")),
  };
  const macosEnv = {
    SELFHOST_HOME: MACOS_HOME,
    SELFHOST_MODELS_DIR: guestJoin(MACOS_HOME, join("models", "gguf")),
  };
  return {
    schema: ATTACH_SCHEMA,
    name,
    digest,
    write: spec.write,
    include,
    models,
    skills,
    omit: DEFAULT_OMIT.filter((item) => !include.includes(item)).sort(),
    mounts,
    env: envGuest,
    macos: {
      home: MACOS_HOME,
      models: macosEnv.SELFHOST_MODELS_DIR,
      env: macosEnv,
      share: "",
    },
  };
}

export function attachRecord(plan) {
  return `${JSON.stringify({
    schema: ATTACH_SCHEMA,
    digest: plan.digest,
    container: plan.env,
    macos: plan.macos.env,
  }, null, 2)}\n`;
}

export function prepareView(env, plan) {
  const home = layout(env).root;
  const base = realInsideSync(home, join(home, "attach", plan.name));
  rmSync(base, { recursive: true, force: true });
  const root = join(base, "root");
  mkdirSync(root, { recursive: true });
  for (const item of plan.include) mkdirSync(join(root, item), { recursive: true });
  const emptyGguf = join(base, "empty-gguf");
  mkdirSync(emptyGguf, { recursive: true });
  for (const file of plan.models ?? []) writeFileSync(join(emptyGguf, file), "");
  mkdirSync(join(base, "empty-skills"), { recursive: true });
  writeFileSync(join(root, "attach.json"), attachRecord(plan));
  return base;
}

function skipTree(from, dest) {
  const rel = relative(dest, from);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && rel !== "..");
}

function linkTree(from, dest, plan, home, skipped) {
  if (skipTree(from, dest)) return;
  mkdirSync(dest, { recursive: true });
  for (const kid of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, kid.name);
    const target = join(dest, kid.name);
    if (kid.isSymbolicLink()) {
      skipped.push(relative(home, src));
      continue;
    }
    if (kid.isDirectory()) {
      const rel = relative(home, src);
      if (plan.skills !== null && rel.endsWith(`${sep}.agents${sep}skills`)) {
        mkdirSync(target, { recursive: true });
        for (const skill of plan.skills) {
          const skillSrc = join(src, skill);
          try {
            const st = lstatSync(skillSrc);
            if (!st.isDirectory() || st.isSymbolicLink()) continue;
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
          linkTree(skillSrc, join(target, skill), plan, home, skipped);
        }
        continue;
      }
      if (plan.models !== null && rel === join("models", "gguf")) {
        mkdirSync(target, { recursive: true });
        for (const file of plan.models) linkSync(join(src, file), join(target, file));
        continue;
      }
      linkTree(src, target, plan, home, skipped);
      continue;
    }
    if (kid.isFile()) linkSync(src, target);
  }
}

export function materializeMacos(env, plan, sandbox) {
  if (!NAME_RE.test(sandbox)) throw new AttachError("sandbox");
  const paths = layout(env);
  const sandboxDir = join(paths.agentDesktop, "sandboxes", sandbox);
  try {
    const st = lstatSync(sandboxDir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new AttachError("sandbox");
  } catch (error) {
    if (error instanceof AttachError) throw error;
    throw new AttachError("sandbox");
  }
  const share = join(sandboxDir, "vm", "share");
  const dest = realInsideSync(paths.root, join(share, "self-hosted"));
  mkdirSync(share, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const skipped = [];
  for (const item of plan.include) {
    const src = join(paths.root, item);
    try {
      const st = lstatSync(src);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    linkTree(src, join(dest, item), plan, paths.root, skipped);
  }
  writeFileSync(join(dest, "attach.json"), attachRecord(plan));
  return { host: dest, guest: MACOS_HOME, skipped };
}

export function containerArgv(plan, image, command = []) {
  if (typeof image !== "string" || image === "" || /[\n,]/.test(image)) throw new AttachError("image");
  for (const arg of command) {
    if (typeof arg !== "string" || arg.includes("\n") || arg.includes("\0")) throw new AttachError("command");
  }
  const args = [
    "run", "--rm", "--name", `selfhost-${plan.digest.slice(0, 12)}`,
    "--progress", "none", "--workdir", CONTAINER_HOME,
  ];
  for (const mount of plan.mounts) {
    const mode = mount.readonly ? ",readonly" : "";
    args.push("--mount", `type=bind,source=${mount.source},target=${mount.target}${mode}`);
  }
  for (const [key, value] of Object.entries(plan.env)) args.push("-e", `${key}=${value}`);
  args.push(image, ...command);
  return args;
}
