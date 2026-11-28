export function portRef(name) {
  return `port {${name}}`;
}

export function serviceUrl(name) {
  return `https://${name}.localhost`;
}

export function localDevHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
  return host.endsWith(".localhost");
}

export function localDevUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!localDevHost(url.hostname)) return null;
  return url.toString();
}
