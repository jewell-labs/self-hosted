import { isAbsolute, resolve } from "./path.js";

export function fileURLToPath(value) {
  const url = value instanceof URL ? value : new URL(String(value));
  if (url.protocol !== "file:") throw new TypeError("not a file URL");
  return decodeURIComponent(url.pathname);
}

export function pathToFileURL(value) {
  const path = isAbsolute(value) ? value : resolve(value);
  const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return new URL(`file://${encoded}`);
}

export default { fileURLToPath, pathToFileURL };
