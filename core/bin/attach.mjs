// attach-plan prints the mount. attach-run starts an Apple container.
// attach-macos fills one sandbox share and does not start the VM.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { attachPlan, containerArgv, materializeMacos, prepareView } from "../lib/attach.mjs";
import { containerEnv } from "../lib/paths.mjs";

function take(argv) {
  const opts = { name: "arm", filter: "-", sandbox: "", write: false, models: null, skills: null, include: null, exclude: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--write") {
      opts.write = true;
      continue;
    }
    const flag = {
      "--name": "name",
      "--filter": "filter",
      "--sandbox": "sandbox",
      "--models": "models",
      "--skills": "skills",
      "--include": "include",
      "--exclude": "exclude",
    }[arg];
    if (!flag) {
      rest.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(flag);
    opts[flag] = value;
    i += 1;
  }
  return { opts, rest };
}

function list(value, label) {
  if (value == null) return undefined;
  if (value === "") throw new Error(label);
  return value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

function loadFilter(opts) {
  const flags = {
    include: list(opts.include, "include"),
    exclude: list(opts.exclude, "exclude"),
    models: list(opts.models, "model"),
    skills: list(opts.skills, "skill"),
  };
  const flagged = Object.values(flags).some((item) => item !== undefined);
  if (opts.filter !== "-") {
    if (flagged) throw new Error("filter");
    const doc = JSON.parse(readFileSync(opts.filter, "utf8"));
    return { ...doc, name: opts.name, write: opts.write || doc.write === true };
  }
  return { name: opts.name, write: opts.write, ...flags };
}

const { opts, rest } = take(process.argv.slice(3));
const command = process.argv[2];
try {
  if (command !== "plan" && command !== "run" && command !== "macos") throw new Error("usage");
  const plan = await attachPlan(process.env, loadFilter(opts));
  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (command === "macos") {
    const share = materializeMacos(process.env, plan, opts.sandbox || rest[0] || "");
    process.stdout.write(`${JSON.stringify({ digest: plan.digest, ...share }, null, 2)}\n`);
  } else {
    const [image, ...cmd] = rest;
    if (!image) throw new Error("image");
    prepareView(process.env, plan);
    const child = spawn("container", containerArgv(plan, image, cmd), { stdio: "inherit", env: containerEnv() });
    child.on("error", (error) => {
      console.error(error.message);
      process.exit(1);
    });
    child.on("exit", (code) => process.exit(code ?? 1));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
