import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deadFindings,
  deadNames,
  exportedNames,
  formatFindings,
  formatProblems,
  isText,
  renderReport,
  repoLocation,
  runnerFindings,
  syntaxFinding,
  testFindings,
} from "./check.mjs";

test("format rejects trailing whitespace and a missing newline", () => {
  assert.deepEqual(formatProblems("a.mjs", "const n = 1;\n"), []);
  assert.deepEqual(formatProblems("a.mjs", "const n = 1; \n"), ["a.mjs:1: trailing whitespace"]);
  assert.deepEqual(formatProblems("a.mjs", "const n = 1;"), ["a.mjs: missing final newline"]);
});

test("format names every trailing line and the file to fix", () => {
  const findings = formatFindings("lib/foo.mjs", "const a = 1; \nconst b = 2;\t\nconst c = 3;");
  assert.equal(findings[0].file, "lib/foo.mjs");
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].message, "trailing whitespace on lines 1, 2");
  assert.match(findings[0].fix, /lines 1, 2 in lib\/foo\.mjs/);
  assert.equal(findings[1].line, 3);
  assert.equal(findings[1].message, "missing final newline");
  assert.match(findings[1].fix, /end of lib\/foo\.mjs/);
});

test("exported names include declarations and aliases", () => {
  const source = "export async function run() {}\nexport const ID = 1;\nexport { local as publicName, other };\n";
  assert.deepEqual(exportedNames(source).sort(), ["ID", "other", "publicName", "run"]);
});

test("dead names ignore command entry points and names used elsewhere", () => {
  const files = [
    { path: "lib/one.mjs", text: "export function used() {}\nexport function alone() {}\nexport function kept() { return kept; }\n" },
    { path: "lib/two.mjs", text: "import { used } from \"./one.mjs\";\nused();\n" },
    { path: "plugins/demo/commands.mjs", text: "export async function setup() {}\nexport function orphan() {}\n" },
    { path: "runtime/node/process.js", text: "export function shim() {}\n" },
  ];
  assert.deepEqual(deadNames(files), ["lib/one.mjs: alone", "plugins/demo/commands.mjs: orphan"]);
  assert.equal(isText("githooks/pre-commit"), true);
  assert.equal(isText("flake.lock"), false);
});

test("dead export failure names the export line and the file", () => {
  const findings = deadFindings([
    { path: "lib/one.mjs", text: "export function used() {}\nexport function alone() {}\n" },
    { path: "lib/two.mjs", text: "import { used } from \"./one.mjs\";\nused();\n" },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "lib/one.mjs");
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].message, "unused export alone");
  assert.match(findings[0].fix, /lib\/one\.mjs:2/);
  assert.match(findings[0].fix, /another \.mjs or \.js file/);
});

test("syntax failure names the file, line, and check command", () => {
  const output = "/repo/lib/foo.mjs:14\n\nSyntaxError: Unexpected token '}'\n    at checkSyntax\n";
  const finding = syntaxFinding("lib/foo.mjs", output);
  assert.equal(finding.file, "lib/foo.mjs");
  assert.equal(finding.line, 14);
  assert.equal(finding.message, "SyntaxError: Unexpected token '}'");
  assert.match(finding.fix, /node --check lib\/foo\.mjs/);
});

test("actions-runner failure points at setup()", () => {
  const source = "export async function setup(ctx) {\n  process.exit(0);\n}\n";
  assert.deepEqual(runnerFindings(1, "refusing actions-runner: this repository is public\n", source), []);
  const finding = runnerFindings(0, "actions-runner override recorded\n", source)[0];
  assert.equal(finding.file, "actions-runner/commands.mjs");
  assert.equal(finding.line, 1);
  assert.match(finding.message, /exited 0/);
  assert.match(finding.fix, /refusing actions-runner: this repository is public/);
  assert.match(finding.fix, /exits 1 before it writes state/);
});

test("a failed test names its file, line, expected, and actual", () => {
  const tap = [
    "TAP version 13",
    "# Subtest: adds",
    "not ok 1 - adds",
    "  ---",
    "  duration_ms: 0.8",
    "  location: '/repo/test/hooks.test.mjs:12:3'",
    "  failureType: 'testCodeFailure'",
    "  error: |-",
    "    Expected values to be strictly equal:",
    "    1 !== 2",
    "  expected: 2",
    "  actual: 1",
    "  ...",
    "# pass 4",
    "# fail 1",
  ].join("\n");
  const parsed = testFindings(tap, "/repo");
  assert.equal(parsed.pass, 4);
  assert.equal(parsed.fail, 1);
  assert.equal(parsed.findings.length, 1);
  const finding = parsed.findings[0];
  assert.equal(finding.file, "test/hooks.test.mjs");
  assert.equal(finding.line, 12);
  assert.match(finding.message, /adds/);
  assert.match(finding.message, /1 !== 2/);
  assert.equal(finding.expected, "2");
  assert.equal(finding.actual, "1");
  assert.match(finding.fix, /node --test test\/hooks\.test\.mjs/);
});

test("a test that fails to load keeps the Node error and the file", () => {
  const tap = [
    "# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/missing.mjs' imported from /repo/test/import.mjs",
    "# Subtest: /repo/test/import.mjs",
    "not ok 1 - /repo/test/import.mjs",
    "  ---",
    "  location: '/repo/test/import.mjs:1:1'",
    "  error: 'test failed'",
    "  ...",
    "# pass 0",
    "# fail 1",
  ].join("\n");
  const finding = testFindings(tap, "/repo").findings[0];
  assert.equal(finding.file, "test/import.mjs");
  assert.equal(finding.line, 1);
  assert.match(finding.message, /Cannot find module '\/repo\/missing\.mjs'/);
  assert.match(finding.fix, /missing import in test\/import\.mjs/);
});

test("a syntax error reported by the test runner uses the file line from the comment", () => {
  const tap = [
    "# file:///repo/test/bad.mjs:8",
    "# SyntaxError: Unexpected end of input",
    "not ok 1 - /repo/test/bad.mjs",
    "  ---",
    "  location: '/repo/test/bad.mjs:1:1'",
    "  error: 'test failed'",
    "  ...",
  ].join("\n");
  const finding = testFindings(tap, "/repo").findings[0];
  assert.equal(finding.file, "test/bad.mjs");
  assert.equal(finding.line, 8);
  assert.match(finding.message, /SyntaxError: Unexpected end of input/);
});

test("repo location keeps a test path when the root does not match", () => {
  assert.deepEqual(repoLocation("/different", "/private/tmp/repo/test/hooks.test.mjs:4:1"), {
    file: "test/hooks.test.mjs",
    line: 4,
  });
});

test("profile reports every stage and a passing run has no FAIL line", () => {
  const text = renderReport([
    { stage: "read", status: "ok", ms: 10, detail: "2 files" },
    { stage: "test", status: "ok", ms: 90, detail: "3 passed, 0 failed" },
  ], []);
  assert.match(text, /^profile\n/);
  assert.match(text, /read\s+ok\s+10\b/);
  assert.match(text, /test\s+ok\s+90\b/);
  assert.match(text, /total\s+ok\s+100\s+100%  slowest test/);
  assert.equal(text.includes("FAIL"), false);
  assert.match(text, /hooks: ok\n$/);
});

test("a failing report names the target after the profile", () => {
  const text = renderReport([
    { stage: "read", status: "ok", ms: 10, detail: "2 files" },
    { stage: "syntax", status: "ok", ms: 20, detail: "1 file" },
    { stage: "actions-runner", status: "ok", ms: 30, detail: "refused public repo" },
    { stage: "format", status: "fail", ms: 5, detail: "1 problem" },
    { stage: "dead", status: "ok", ms: 15, detail: "0 unused exports" },
    { stage: "test", status: "ok", ms: 100, detail: "3 passed, 0 failed" },
  ], [{
    check: "format",
    file: "a.mjs",
    line: 1,
    message: "trailing whitespace on line 1",
    fix: "delete the spaces or tabs at the end of line 1 in a.mjs",
  }]);
  assert.match(text, /format\s+fail\s+5\b/);
  assert.match(text, /total\s+fail\s+180\s+100%/);
  assert.match(text, /FAIL format a\.mjs:1\n {2}message: trailing whitespace on line 1\n {2}fix: delete the spaces or tabs at the end of line 1 in a\.mjs/);
  assert.match(text, /hooks: fail\n$/);
  assert.ok(text.indexOf("FAIL format") > text.indexOf("profile"));
});
