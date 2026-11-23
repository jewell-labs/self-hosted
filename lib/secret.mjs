const SECRET_SOURCE = "BEGIN OPENSSH PRIVATE KEY|cfast_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}";

export const SECRET_RE = new RegExp(SECRET_SOURCE);

export function redactSecrets(text) {
  return String(text ?? "").replace(new RegExp(SECRET_SOURCE, "g"), "[redacted]");
}
