import { join } from "node:path";

const LABEL = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/;
const PROJECT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function repoName(project) {
  if (typeof project !== "string" || !PROJECT.test(project)) throw new Error("project must be org/name");
  const name = project.split("/")[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!LABEL.test(name)) throw new Error("project name is not a label");
  return name;
}

export function label(value, field) {
  if (typeof value !== "string" || !LABEL.test(value)) throw new Error(`${field} must be a DNS label`);
  return value;
}

export function workPath(root, input) {
  const project = repoName(input.project);
  const harness = label(input.harness, "harness");
  const domain = label(input.domain, "domain");
  const slug = label(input.slug, "slug");
  return join(root, `${project}-${harness}-${domain}-${slug}`);
}
