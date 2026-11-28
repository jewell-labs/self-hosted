// Pre-commit checks. Prints a profile, and on failure the file, line, and fix.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { packageIds, pluginFindings } from "../core/lib/plugins.mjs";

const TEXT_EXT = new Set([".mjs", ".js", ".json", ".md", ".nix", ".sh", ".yml", ".yaml"]);
const DECL = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const REFUSAL = "refusing actions-runner: this repository is public";
const RUNNER_FILE = "actions-runner/commands.mjs";

export function isText(path) {
  return path.startsWith("githooks/") || TEXT_EXT.has(extname(path));
}

function padRight(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function oneLine(value, limit = 360) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function percent(ms, total) {
  if (total <= 0) return 0;
  return Math.round((ms / total) * 100);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportLine(source, name) {
  const lines = String(source).split("\n");
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${name}\\b`);
  const alias = new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`);
  for (let i = 0; i < lines.length; i += 1) {
    if (decl.test(lines[i]) || alias.test(lines[i])) return i + 1;
  }
  return null;
}

export function formatFindings(path, text) {
  const findings = [];
  const lines = text.split("\n");
  const last = text.endsWith("\n") ? lines.length - 1 : lines.length;
  const bad = [];
  for (let i = 0; i < last; i += 1) {
    if (/[ \t]$/.test(lines[i])) bad.push(i + 1);
  }
  if (bad.length > 0) {
    const shown = bad.slice(0, 20);
    const extra = bad.length - shown.length;
    const list = shown.join(", ");
    const label = shown.length === 1 ? "line" : "lines";
    const more = extra > 0 ? ` (and ${extra} more)` : "";
    const fix = extra > 0
      ? `delete the spaces or tabs at the end of ${label} ${list} in ${path}, then remove the remaining ${extra} trailing-whitespace lines in that file`
      : `delete the spaces or tabs at the end of ${label} ${list} in ${path}`;
    findings.push({
      check: "format",
      file: path,
      line: bad[0],
      message: `trailing whitespace on ${label} ${list}${more}`,
      fix,
    });
  }
  if (text.length > 0 && !text.endsWith("\n")) {
    findings.push({
      check: "format",
      file: path,
      line: lines.length,
      message: "missing final newline",
      fix: `append one newline at the end of ${path}`,
    });
  }
  return findings;
}

export function formatProblems(path, text) {
  return formatFindings(path, text).map((item) => (
    item.message.startsWith("trailing whitespace")
      ? `${item.file}:${item.line}: trailing whitespace`
      : `${item.file}: ${item.message}`
  ));
}

export function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(DECL)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function skippedExport(path, name) {
  return (path.endsWith("/commands.mjs") || path === "commands.mjs") && (name === "setup" || name === "check");
}

function mentions(text, name) {
  return text.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
}

export function deadFindings(files) {
  const code = files.filter((file) => file.path.endsWith(".mjs") || file.path.endsWith(".js"));
  const findings = [];
  for (const file of code) {
    if (file.path.startsWith("core/runtime/") || file.path.startsWith("core/bin/") || file.path.startsWith("core/test/") || file.path.startsWith("runtime/") || file.path.startsWith("bin/") || file.path.startsWith("test/") || file.path.startsWith("githooks/")) continue;
    for (const name of exportedNames(file.text)) {
      if (skippedExport(file.path, name)) continue;
      const needle = new RegExp(`\\b${name}\\b`);
      const elsewhere = code.some((other) => other.path !== file.path && needle.test(other.text));
      if (elsewhere || mentions(file.text, name) > 1) continue;
      const line = exportLine(file.text, name);
      const where = line ? `${file.path}:${line}` : file.path;
      findings.push({
        check: "dead",
        file: file.path,
        line,
        exportName: name,
        message: `unused export ${name}`,
        fix: `delete export ${name} from ${where}, or reference ${name} from another .mjs or .js file. A name that appears only at its export is unused`,
      });
    }
  }
  findings.sort((a, b) => `${a.file}: ${a.exportName}`.localeCompare(`${b.file}: ${b.exportName}`));
  return findings;
}

export function deadNames(files) {
  return deadFindings(files).map((item) => `${item.file}: ${item.exportName}`);
}

export function syntaxFinding(path, output) {
  const text = String(output ?? "");
  const located = text.match(new RegExp(`${escapeRegExp(path)}:(\\d+)`));
  const line = located ? Number(located[1]) : null;
  const errorLine = text.match(/^[A-Za-z]*Error: .+$/m);
  const where = line ? `${path}:${line}` : path;
  return {
    check: "syntax",
    file: path,
    line,
    message: errorLine ? errorLine[0] : "node --check failed",
    fix: `repair the syntax error in ${where}, then run: node --check ${path}`,
  };
}

export function runnerFindings(status, text, source = "") {
  if (status !== 0 && String(text).includes(REFUSAL)) return [];
  const line = exportLine(source, "setup");
  const detail = oneLine(String(text).split("\n").map((item) => item.trim()).filter(Boolean)[0] || "no output");
  return [{
    check: "actions-runner",
    file: RUNNER_FILE,
    line,
    message: `setup() exited ${status} without the public-repo refusal (${detail})`,
    fix: `edit setup() in ${RUNNER_FILE} so a public repo prints "${REFUSAL}" and exits 1 before it writes state`,
  }];
}

function stripQuotes(value) {
  const text = String(value).trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

export function repoLocation(root, location) {
  let value = String(location ?? "").trim();
  if (value.startsWith("file://")) value = value.slice("file://".length);
  const match = value.match(/^(.*):(\d+):(\d+)$/) || value.match(/^(.*):(\d+)$/);
  let file = match ? match[1] : value;
  const line = match ? Number(match[2]) : null;
  const prefix = String(root ?? "").replace(/\/$/, "");
  if (prefix && (file === prefix || file.startsWith(`${prefix}/`))) {
    file = file === prefix ? "." : file.slice(prefix.length + 1);
  } else {
    const at = file.lastIndexOf("/test/");
    if (at >= 0) file = file.slice(at + 1);
  }
  return { file, line };
}

function usefulNote(text) {
  if (!text || text.startsWith("at ") || text.startsWith("throw ") || text === "^") return false;
  return text.startsWith("file://") || /Error\b/.test(text);
}

function testFinding(item, root) {
  let located = repoLocation(root, item.location);
  const notes = item.notes ?? [];
  const weak = !item.error || item.error === "test failed";
  const note = notes.find((entry) => /Error\b/.test(entry));
  const fileNote = notes.find((entry) => entry.startsWith("file://"));
  if (weak && fileNote) {
    const better = repoLocation(root, fileNote);
    if (better.line) {
      located = located.file && !located.file.startsWith("/")
        ? { file: located.file, line: better.line }
        : better;
    }
  }
  const file = located.file || "test";
  const where = located.line ? `${file}:${located.line}` : file;
  const detail = weak ? (note || fileNote || item.error) : item.error;
  const message = oneLine([item.name, detail].filter(Boolean).join(": "));
  const fix = message.includes("Cannot find module")
    ? `fix the missing import in ${where}, then run: node --test ${file}`
    : `edit ${where} so this test passes, then run: node --test ${file}`;
  return {
    check: "test",
    file,
    line: located.line,
    message,
    expected: oneLine(item.expected, 180),
    actual: oneLine(item.actual, 180),
    fix,
  };
}

export function testFindings(tap, root) {
  const lines = String(tap).split("\n");
  let pass = 0;
  let fail = 0;
  for (const line of lines) {
    const passed = line.match(/^# pass (\d+)/);
    const failed = line.match(/^# fail (\d+)/);
    if (passed) pass = Number(passed[1]);
    if (failed) fail = Number(failed[1]);
  }
  const found = [];
  let current = null;
  let capture = "";
  let notes = [];
  const finish = () => {
    if (!current) return;
    found.push(testFinding(current, root));
    current = null;
    capture = "";
  };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (!/^# (tests |suites |pass |fail |cancelled |skipped |todo |duration_ms |Subtest:)/.test(line)) {
        const text = line.slice(2).trim();
        if (usefulNote(text) && notes.length < 20) notes.push(text);
      }
      continue;
    }
    const started = line.match(/^not ok \d+ - (.*)$/);
    if (started) {
      finish();
      current = { name: started[1].trim(), location: "", error: "", expected: "", actual: "", notes };
      notes = [];
      continue;
    }
    if (!current) continue;
    if (/^\s*\.\.\.\s*$/.test(line)) {
      finish();
      continue;
    }
    if (capture) {
      if (line.startsWith("    ")) {
        const piece = line.trim();
        if (piece) current[capture] = current[capture] ? `${current[capture]} ${piece}` : piece;
        continue;
      }
      capture = "";
    }
    const location = line.match(/^ {2}location:\s+'([^']*)'/) || line.match(/^ {2}location:\s+"([^"]*)"/);
    if (location) {
      current.location = location[1];
      continue;
    }
    const block = line.match(/^ {2}(error|expected|actual):\s+\|[-+]?\s*$/);
    if (block) {
      capture = block[1];
      continue;
    }
    const inline = line.match(/^ {2}(error|expected|actual):\s+(.*)$/);
    if (inline) {
      const value = inline[2].trim();
      if (value !== "|-" && value !== "|" && value !== ">-" && value !== ">") current[inline[1]] = stripQuotes(value);
    }
  }
  finish();
  if (fail === 0) fail = found.length;
  return { findings: found, pass, fail };
}

export function renderFailure(item) {
  const where = item.line ? `${item.file}:${item.line}` : item.file;
  const lines = [`FAIL ${item.check} ${where}`, `  message: ${oneLine(item.message)}`];
  if (item.expected) lines.push(`  expected: ${oneLine(item.expected, 180)}`);
  if (item.actual) lines.push(`  actual: ${oneLine(item.actual, 180)}`);
  lines.push(`  fix: ${oneLine(item.fix)}`);
  return lines.join("\n");
}

export function renderProfile(rows) {
  const stageW = Math.max(14, ...rows.map((row) => row.stage.length));
  const lines = [
    "profile",
    `${padRight("stage", stageW)}  ${padRight("status", 6)}  ${padLeft("ms", 8)}  ${padLeft("pct", 4)}  detail`,
  ];
  for (const row of rows) {
    lines.push(`${padRight(row.stage, stageW)}  ${padRight(row.status, 6)}  ${padLeft(row.ms, 8)}  ${padLeft(`${row.pct}%`, 4)}  ${row.detail}`);
  }
  return lines.join("\n");
}

export function renderReport(stages, failures) {
  const totalMs = stages.reduce((sum, stage) => sum + stage.ms, 0);
  const failed = failures.length > 0 || stages.some((stage) => stage.status === "fail");
  const slowest = stages.reduce((best, stage) => (stage.ms > best.ms ? stage : best), stages[0]);
  const rows = stages.map((stage) => ({ ...stage, pct: percent(stage.ms, totalMs) }));
  rows.push({
    stage: "total",
    status: failed ? "fail" : "ok",
    ms: totalMs,
    pct: 100,
    detail: slowest ? `slowest ${slowest.stage}` : "",
  });
  const parts = [renderProfile(rows)];
  const shown = failures.slice(0, 40);
  if (shown.length > 0) parts.push(shown.map(renderFailure).join("\n\n"));
  if (failures.length > shown.length) {
    const rest = failures.length - shown.length;
    parts.push(renderFailure({
      check: "hooks",
      file: "githooks/check.mjs",
      line: null,
      message: `${rest} more failures were not printed`,
      fix: "fix the failures above, then run: node githooks/check.mjs",
    }));
  }
  parts.push(failed ? "hooks: fail" : "hooks: ok");
  return `${parts.join("\n\n")}\n`;
}

function gitFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || "git ls-files failed").trim());
  return result.stdout.split("\0").filter(Boolean);
}

function readTracked(root) {
  const files = [];
  for (const path of gitFiles(root)) {
    if (!isText(path)) continue;
    try {
      files.push({ path, text: readFileSync(`${root}/${path}`, "utf8") });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

function syntaxProblems(root, files) {
  const findings = [];
  let checked = 0;
  let slowPath = "";
  let slowMs = -1;
  for (const file of files) {
    if (!file.path.endsWith(".mjs") && !file.path.endsWith(".js")) continue;
    checked += 1;
    const start = performance.now();
    const result = spawnSync(process.execPath, ["--check", file.path], { cwd: root, encoding: "utf8" });
    const ms = performance.now() - start;
    if (ms > slowMs) {
      slowMs = ms;
      slowPath = file.path;
    }
    if (result.status !== 0) {
      findings.push(syntaxFinding(file.path, `${result.stderr ?? ""}\n${result.stdout ?? ""}`));
    }
  }
  const slow = Math.round(slowMs);
  const detail = checked === 0
    ? "0 files"
    : slow >= 1
      ? `${count(checked, "file")}, slowest ${slowPath} ${slow}ms`
      : count(checked, "file");
  return { findings, detail };
}

function runnerProblem(root) {
  const env = { ...process.env };
  delete env.ALLOW_PUBLIC_REPO_RUNNER;
  const result = spawnSync(process.execPath, ["core/bin/setup.mjs", "actions-runner"], { cwd: root, encoding: "utf8", env });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  let source = "";
  try {
    source = readFileSync(`${root}/${RUNNER_FILE}`, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const findings = runnerFindings(result.status ?? 1, text, source);
  return {
    findings,
    detail: findings.length === 0 ? "refused public repo" : "missing public-repo refusal",
  };
}

function testProblems(root, brokenTests) {
  const tests = gitFiles(root).filter((path) => path.endsWith(".test.mjs") && !brokenTests.has(path));
  if (tests.length === 0) {
    if (brokenTests.size > 0) return { pass: 0, fail: 0, findings: [], detail: "skipped, syntax failed" };
    return {
      pass: 0,
      fail: 1,
      findings: [{
        check: "test",
        file: "test",
        line: null,
        message: "no test files matched **/*.test.mjs",
        fix: "restore the test/*.mjs files, then run: node --test",
      }],
      detail: "no test files",
    };
  }
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const tap = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const parsed = testFindings(tap, root);
  if (result.status !== 0 && parsed.findings.length === 0) {
    const detail = oneLine(tap.trim().split("\n").filter(Boolean).slice(0, 6).join(" / ") || `node --test exited ${result.status}`);
    parsed.findings.push({
      check: "test",
      file: tests[0],
      line: null,
      message: detail,
      fix: `run: node --test ${tests.join(" ")}`,
    });
    parsed.fail = Math.max(parsed.fail, 1);
  }
  const skipped = brokenTests.size > 0 ? `, ${count(brokenTests.size, "file")} skipped` : "";
  return { ...parsed, detail: `${parsed.pass} passed, ${parsed.fail} failed${skipped}` };
}

function stage(name, ms, findings, detail) {
  return { stage: name, status: findings.length > 0 ? "fail" : "ok", ms, detail };
}

function elapsed(start) {
  return Math.max(0, Math.round(performance.now() - start));
}

function finish(report, code) {
  process.stdout.write(report, () => process.exit(code));
}

function run() {
  const root = process.cwd();
  const stages = [];
  const failures = [];

  let start = performance.now();
  const files = readTracked(root);
  stages.push(stage("read", elapsed(start), [], count(files.length, "file")));

  start = performance.now();
  const syntax = syntaxProblems(root, files);
  stages.push(stage("syntax", elapsed(start), syntax.findings, syntax.detail));
  failures.push(...syntax.findings);

  start = performance.now();
  const runner = runnerProblem(root);
  stages.push(stage("actions-runner", elapsed(start), runner.findings, runner.detail));
  failures.push(...runner.findings);

  start = performance.now();
  const format = files.flatMap((file) => formatFindings(file.path, file.text));
  stages.push(stage("format", elapsed(start), format, format.length > 0 ? count(format.length, "problem") : count(files.length, "file")));
  failures.push(...format);

  start = performance.now();
  const dead = deadFindings(files);
  stages.push(stage("dead", elapsed(start), dead, count(dead.length, "unused export")));
  failures.push(...dead);

  start = performance.now();
  const plugins = pluginFindings(root);
  const pluginDetail = plugins.length > 0 ? count(plugins.length, "problem") : count(packageIds(root).length, "package");
  stages.push(stage("plugins", elapsed(start), plugins, pluginDetail));
  failures.push(...plugins);

  start = performance.now();
  const brokenTests = new Set(syntax.findings.map((item) => item.file).filter((file) => file.endsWith(".test.mjs")));
  const tests = testProblems(root, brokenTests);
  stages.push(stage("test", elapsed(start), tests.findings, tests.detail));
  failures.push(...tests.findings);

  finish(renderReport(stages, failures), failures.length > 0 ? 1 : 0);
}

function main() {
  try {
    run();
  } catch (error) {
    const message = error && error.stack ? error.stack.split("\n").slice(0, 2).join(" ") : String(error);
    finish(renderReport([], [{
      check: "hooks",
      file: "githooks/check.mjs",
      line: null,
      message,
      fix: "repair githooks/check.mjs so the pre-commit check can finish, then run: node githooks/check.mjs",
    }]), 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
