export const sep = "/";
export const delimiter = ":";

export function isAbsolute(value) {
  return String(value).startsWith("/");
}

export function basename(value, ext) {
  const trimmed = String(value).length > 1 ? String(value).replace(/\/+$/, "") : String(value);
  const slash = trimmed.lastIndexOf("/");
  let base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
  return base;
}

export function dirname(value) {
  const text = String(value);
  const trimmed = text.length > 1 ? text.replace(/\/+$/, "") : text;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return trimmed.slice(0, slash);
}

export function extname(value) {
  const base = basename(value);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

function normalize(value) {
  const absolute = value.startsWith("/");
  const bits = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (bits.length > 0 && bits[bits.length - 1] !== "..") bits.pop();
      else if (!absolute) bits.push("..");
    } else bits.push(part);
  }
  const body = bits.join("/");
  if (absolute) return body ? `/${body}` : "/";
  return body || ".";
}

export function join(...parts) {
  const kept = parts.filter((part) => part !== undefined && part !== "");
  if (kept.length === 0) return ".";
  let out = String(kept[0]);
  for (const part of kept.slice(1)) {
    const text = String(part);
    if (text.startsWith("/")) out = text;
    else out = `${out.replace(/\/+$/, "")}/${text}`;
  }
  return normalize(out);
}

export function resolve(...parts) {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    const text = String(part);
    out = text.startsWith("/") ? text : (out ? `${out}/${text}` : text);
  }
  if (!out.startsWith("/")) {
    const cwd = globalThis.process?.cwd?.() ?? "/";
    out = `${cwd.replace(/\/+$/, "")}/${out}`;
  }
  return normalize(out);
}

export function relative(from, to) {
  const left = resolve(from).split("/").filter(Boolean);
  const right = resolve(to).split("/").filter(Boolean);
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  const up = left.slice(index).map(() => "..");
  return [...up, ...right.slice(index)].join("/");
}

export default { sep, delimiter, isAbsolute, basename, dirname, extname, join, resolve, relative };
