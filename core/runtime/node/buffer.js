const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(text, url) {
  const normalized = url ? text.replaceAll("-", "+").replaceAll("_", "/") : text;
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes, url) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  const text = btoa(bin);
  if (!url) return text;
  return text.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class Buffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value === "string") {
      if (encoding === "base64" || encoding === "base64url") return new Buffer(fromBase64(value, encoding === "base64url"));
      return new Buffer(encoder.encode(value));
    }
    if (value instanceof ArrayBuffer) return new Buffer(value);
    if (ArrayBuffer.isView(value)) {
      const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const out = new Buffer(view.byteLength);
      out.set(view);
      return out;
    }
    if (Array.isArray(value)) return new Buffer(value);
    throw new TypeError("Buffer.from");
  }

  static concat(list, total) {
    const parts = list.map((part) => Buffer.from(part));
    const size = total ?? parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Buffer(size);
    let offset = 0;
    for (const part of parts) {
      const take = Math.min(part.length, size - offset);
      if (take <= 0) break;
      out.set(part.subarray(0, take), offset);
      offset += take;
    }
    return out;
  }

  static isBuffer(value) {
    return value instanceof Buffer;
  }

  toString(encoding = "utf8") {
    if (encoding === "hex") {
      let hex = "";
      for (const byte of this) hex += byte.toString(16).padStart(2, "0");
      return hex;
    }
    if (encoding === "base64") return toBase64(this, false);
    if (encoding === "base64url") return toBase64(this, true);
    return decoder.decode(this);
  }
}

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return encoder.encode(String(value));
}
