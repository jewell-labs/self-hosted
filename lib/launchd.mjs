// LaunchAgent plists load only from the account LaunchAgents directory.
// The home keeps a copy so a moved directory can write them again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout, userHome } from "./paths.mjs";

export const LAUNCHD_SCHEMA = "jewell-labs.self-hosted.launchd.v1";

export function agentsDirectory(env = process.env) {
  return join(userHome(env), "Library", "LaunchAgents");
}

function agentFile(env, label) {
  return join(layout(env).launchd, "agents", `${label}.plist`);
}

function readDoc(file) {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return {
      schema: LAUNCHD_SCHEMA,
      home: typeof doc.home === "string" ? doc.home : "",
      labels: Array.isArray(doc.labels) ? doc.labels.filter((item) => typeof item === "string") : [],
      agents: Array.isArray(doc.agents) ? doc.agents.filter((item) => typeof item === "string") : [],
    };
  } catch {
    return { schema: LAUNCHD_SCHEMA, home: "", labels: [], agents: [] };
  }
}

function writeDoc(env, doc) {
  const paths = layout(env);
  mkdirSync(paths.launchd, { recursive: true });
  const home = doc.home || paths.root;
  writeFileSync(paths.labels, `${JSON.stringify({ ...doc, schema: LAUNCHD_SCHEMA, home }, null, 2)}\n`);
}

// A home path ends at a directory slash, the end of the text, or the XML and
// whitespace that close a plist string. A following path character stays put.
const HOME_BOUNDARY = "(?=/|$|\\s|<)";

function homeRegExp(home, flags = "") {
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}${HOME_BOUNDARY}`, flags);
}

export function rewriteHome(body, from, to) {
  if (!from || from === to) return body;
  return body.replace(homeRegExp(from, "g"), to);
}

function homeRemains(body, home) {
  return Boolean(home) && homeRegExp(home).test(body);
}

// Keep the plist bytes inside the home. Does not write a LaunchAgent.
export function saveAgent(env, label, body) {
  const dest = agentFile(env, label);
  mkdirSync(join(layout(env).launchd, "agents"), { recursive: true });
  writeFileSync(dest, body);
  const doc = readDoc(layout(env).labels);
  if (!doc.labels.includes(label)) doc.labels.push(label);
  if (!doc.agents.includes(label)) doc.agents.push(label);
  writeDoc(env, doc);
  return dest;
}

// Write the account LaunchAgent and the home copy. The two bodies match.
export function publishAgent(env, label, body) {
  const saved = saveAgent(env, label, body);
  const dir = agentsDirectory(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label}.plist`), body);
  return saved;
}

// Copy live LaunchAgents into the home. A plist that already lives only in the
// home stays there, so a later install can recreate it.
export function recordLaunchAgents(env, labels) {
  const live = agentsDirectory(env);
  mkdirSync(join(layout(env).launchd, "agents"), { recursive: true });
  for (const label of labels) {
    const src = join(live, `${label}.plist`);
    if (!existsSync(src)) continue;
    writeFileSync(agentFile(env, label), readFileSync(src));
  }
  const doc = readDoc(layout(env).labels);
  doc.labels = [...labels];
  doc.agents = labels.filter((label) => existsSync(agentFile(env, label)));
  writeDoc(env, doc);
  return doc;
}

// Write recorded plists into this account's LaunchAgents directory.
// Paths that pointed at the home where they were recorded now point at this home.
export function installLaunchAgents(env = process.env) {
  const paths = layout(env);
  const doc = readDoc(paths.labels);
  if (!existsSync(paths.labels)) {
    throw new Error("no launchd record in the home");
  }
  const dir = agentsDirectory(env);
  mkdirSync(dir, { recursive: true });
  const written = [];
  let pending = false;
  for (const label of doc.agents) {
    const src = agentFile(env, label);
    if (!existsSync(src)) continue;
    const body = rewriteHome(readFileSync(src, "utf8"), doc.home, paths.root);
    writeFileSync(src, body);
    if (doc.home && doc.home !== paths.root && homeRemains(body, doc.home)) pending = true;
    const dest = join(dir, `${label}.plist`);
    writeFileSync(dest, body);
    written.push(dest);
  }
  if (!pending) {
    doc.home = paths.root;
    writeDoc(env, doc);
  }
  return written;
}
