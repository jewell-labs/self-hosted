// Bytes of the cleanup keep paths that sit outside this home fail the report.
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { relation } from "./cleanup.mjs";
import { homeDir, userHome } from "./paths.mjs";

export const DISK_MIN_BYTES = 1024 ** 3;

function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

export function diskContext(env, keep) {
  const home = resolve(userHome(env));
  const root = resolve(homeDir(env));
  const shared = resolve(env.SELFHOST_SHARED ?? "/Users/Shared");
  const min = Number(env.SELFHOST_DISK_MIN ?? DISK_MIN_BYTES);
  return {
    home,
    root,
    shared,
    keep,
    minBytes: Number.isFinite(min) && min > 0 ? min : DISK_MIN_BYTES,
    pinned: [
      join(home, "Library", "LaunchAgents"),
      join(home, "Library", "Developer", "CoreSimulator"),
      join(home, "Library", "Application Support", "com.apple.wallpaper"),
    ],
    orphan: [
      join(home, "Library", "Caches", "lima"),
      join(home, ".tart"),
      join(shared, "studio-models"),
    ],
    copy: [join(home, "self-hosted-work-preserve")],
    tool: [
      join(home, ".codex"),
      join(home, ".grok"),
      join(home, ".claude"),
      join(home, ".npm"),
      join(home, ".appium"),
      join(home, ".agent-browser"),
      join(home, ".local"),
      join(home, "local"),
      join(home, "Library", "pnpm"),
      join(home, "Library", "Caches", "ms-playwright"),
      join(home, "Library", "Caches", "pnpm"),
      join(home, "Library", "Caches", "Homebrew"),
      join(home, "Library", "Caches", "Google"),
      join(home, "Library", "Application Support", "Google"),
    ],
    ownedOutside: [
      join(shared, "studio-models", "mlx"),
      join(shared, "studio-models", "imports"),
    ],
  };
}

export function classify(path, ctx) {
  const abs = resolve(path);
  if (inside(ctx.root, abs)) {
    const rel = relative(ctx.root, abs).split(sep).join("/");
    if (relation(rel === "" ? "." : rel, ctx.keep) === "keep") return "kept";
    return "";
  }
  for (const prefix of ctx.pinned) if (inside(prefix, abs)) return "pinned";
  for (const prefix of ctx.orphan) if (inside(prefix, abs)) return "orphan";
  for (const prefix of ctx.copy) if (inside(prefix, abs)) return "copy";
  for (const prefix of ctx.tool) if (inside(prefix, abs)) return "tool";
  return "";
}

// du started by node blocks on a macOS privacy prompt. The shell measures and passes the text here.
export function loadDu(text) {
  const expanded = new Set();
  const sizes = new Map();
  for (const line of String(text).split("\n")) {
    if (line.startsWith("# ")) {
      expanded.add(resolve(line.slice(2).trim()));
      continue;
    }
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const blocks = Number(match[1]);
    if (Number.isFinite(blocks)) sizes.set(resolve(match[2]), blocks * 1024);
  }
  return { expanded, sizes };
}

function childDirs(path) {
  const found = [];
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    let stat;
    try {
      stat = lstatSync(child);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    found.push(child);
  }
  return found;
}

function holdsClass(path, ctx) {
  const prefixes = [...ctx.pinned, ...ctx.orphan, ...ctx.copy, ...ctx.tool];
  return prefixes.some((prefix) => resolve(prefix) !== resolve(path) && inside(path, prefix));
}

function visit(path, ctx, sizeOf, list, expand) {
  const bytes = sizeOf(path);
  const klass = classify(path, ctx);
  if (klass) {
    const rows = bytes >= ctx.minBytes ? [{ path, bytes, class: klass }] : [];
    return { bytes, unexplained: 0, rows };
  }
  // Open a smaller directory when a class prefix lives inside it, so that prefix
  // does not count as an unexplained remainder of its parent.
  if (bytes < ctx.minBytes && !holdsClass(path, ctx)) return { bytes, unexplained: bytes, rows: [] };
  if (expand) expand(path);
  let explained = 0;
  const rows = [];
  for (const child of list(path)) {
    const sub = visit(child, ctx, sizeOf, list, expand);
    explained += sub.bytes - sub.unexplained;
    rows.push(...sub.rows);
  }
  const unexplained = Math.max(0, bytes - explained);
  if (unexplained >= ctx.minBytes) rows.push({ path, bytes, class: "" });
  return { bytes, unexplained, rows };
}

// A real directory at ~/.agent-desktop is the CLI default. Flag it even under 1 GB.
function realAgentDesktop(ctx) {
  const path = join(ctx.home, ".agent-desktop");
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    return path;
  } catch {
    return null;
  }
}

export function scanRoots(ctx, sizeOf, list = childDirs, expand = null) {
  if (typeof sizeOf !== "function") throw new Error("disk size");
  const rows = [];
  for (const root of [ctx.home, ctx.shared]) {
    if (!existsSync(root)) continue;
    rows.push(...visit(root, ctx, sizeOf, list, expand).rows);
  }
  const desk = realAgentDesktop(ctx);
  if (desk && !rows.some((row) => row.path === desk)) {
    let bytes = 0;
    try {
      bytes = sizeOf(desk);
    } catch {
      bytes = 0;
    }
    rows.push({ path: desk, bytes, class: "" });
  }
  rows.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return rows;
}

export function ownedBytes(ctx, sizeOf) {
  if (typeof sizeOf !== "function") throw new Error("disk size");
  let inside = 0;
  for (const rel of ctx.keep) {
    const path = join(ctx.root, ...rel.split("/"));
    if (existsSync(path)) inside += sizeOf(path);
  }
  let outside = 0;
  for (const path of ctx.ownedOutside) {
    if (existsSync(path)) outside += sizeOf(path);
  }
  return { inside, outside };
}

export function judge(rows, owned) {
  const total = owned.inside + owned.outside;
  const outsideOk = total === 0 || owned.outside * 100 < total;
  const stray = rows.filter((row) => row.class === "");
  return { ok: outsideOk && stray.length === 0, outsideOk, stray };
}

export function formatBytes(bytes) {
  const units = ["B", "K", "M", "G", "T"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(value) : value.toFixed(1);
  return `${shown}${units[unit]}`;
}

export function showPath(path, home) {
  if (inside(home, path)) {
    const rel = relative(home, path);
    return rel === "" ? "~" : `~/${rel.split(sep).join("/")}`;
  }
  return path;
}

export function render(ctx, rows, owned, volume, denied = 0) {
  const lines = [];
  if (volume) lines.push(`volume ${volume.mount} used ${formatBytes(volume.used)} avail ${formatBytes(volume.avail)}`);
  lines.push(`home ${showPath(ctx.home, ctx.home)} ${formatBytes(owned.home ?? 0)}`);
  lines.push(`store ${showPath(ctx.root, ctx.home)} ${formatBytes(owned.store ?? 0)}`);
  const total = owned.inside + owned.outside;
  const pct = total === 0 ? 0 : (owned.outside * 100) / total;
  lines.push(`owned inside ${formatBytes(owned.inside)} outside ${formatBytes(owned.outside)} (${pct.toFixed(1)}%)`);
  if (denied > 0) lines.push(`unreadable ${denied}`);
  for (const row of rows) {
    const name = row.class === "" ? "none" : row.class;
    lines.push(`${name} ${formatBytes(row.bytes)} ${showPath(row.path, ctx.home)}`);
  }
  const verdict = judge(rows, owned);
  lines.push(verdict.ok ? "disk: ok" : "disk: fail");
  return { ...verdict, lines };
}
