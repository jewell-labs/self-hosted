import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";

export const CHOCK_SKILLS = Object.freeze([
  "block-curl-pipe-sh",
  "block-destructive-commands",
  "block-invisible-unicode",
  "block-no-verify",
  "block-unapproved-egress",
  "block-unpinned-agent-components",
  "block-wildcard-agent-permissions",
  "pin-github-actions",
  "protect-agent-config",
  "protect-commit-privacy",
  "scan-secrets",
  "verify-dependency-exists",
  "verify-mcp-allowlist",
  "block-unguarded-agent-spawn",
  "block-hook-bypass-in-files",
  "dockerfile-compose-security",
  "scan-secret-files",
  "agent-permissions-scan",
  "block-persistence-shapes",
  "block-secret-store-reads",
  "iam-policy-scan",
  "protect-main-branch",
]);

const TEXT = new Set([".json", ".jsonl", ".log", ".md", ".txt", ".yml", ".yaml"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function chockUsage(root, sessionsDir) {
  const skills = [];
  for (const id of CHOCK_SKILLS) {
    const file = join(root, ".agents", "skills", id, "SKILL.md");
    const info = await stat(file);
    skills.push({ id, bytes: info.size, mentions: 0 });
  }
  let files = 0;
  if (sessionsDir) {
    const needles = CHOCK_SKILLS.map((id) => ({ id, re: new RegExp(`\\b${escapeRegExp(id)}\\b`, "g") }));
    const walk = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        const dot = entry.name.lastIndexOf(".");
        const ext = dot === -1 ? "" : entry.name.slice(dot);
        if (!TEXT.has(ext)) continue;
        const info = await stat(path);
        if (info.size > 20 * 1024 * 1024) continue;
        const text = await readFile(path, "utf8");
        files += 1;
        for (const needle of needles) {
          const found = text.match(needle.re);
          if (!found) continue;
          const row = skills.find((item) => item.id === needle.id);
          row.mentions += found.length;
        }
      }
    };
    await walk(sessionsDir);
  }
  const bytes = skills.reduce((sum, item) => sum + item.bytes, 0);
  const mentions = sessionsDir ? skills.reduce((sum, item) => sum + item.mentions, 0) : null;
  return {
    status: "trial",
    isolatedPlugin: false,
    worth: "undecided",
    files,
    bytes,
    mentions,
    skills,
  };
}

const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (entry.endsWith("bin/chock-usage.mjs")) {
  const report = await chockUsage(repoRoot(), process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
}
