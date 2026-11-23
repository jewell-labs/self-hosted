// Prove setup-host against a local llama.cpp server.
// The target host is an Apple container. This process is the harness:
// it asks the local model, then runs only the setup and validate commands
// from the discover result inside the container.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const llamaUrl = process.env.LLM_URL ?? process.env.LLAMA_URL ?? "http://127.0.0.1:8080";
const model = process.env.LLM_MODEL ?? process.env.LLAMA_MODEL ?? "";
if (!model) {
  console.error("set LLM_MODEL or LLAMA_MODEL to the model id served by the llm server");
  process.exit(1);
}
const containerBin = process.env.CONTAINER_BIN ?? "container";
const image = process.env.PROOF_IMAGE ?? "docker.io/library/node:22-bookworm";
const name = "selfhost-proof";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => resolve({ code, out, err }));
    child.on("error", reject);
  });
}

async function exec(args) {
  const result = await run(containerBin, ["exec", name, ...args]);
  if (result.code !== 0) {
    throw new Error(`container exec ${args.join(" ")} -> ${result.code}\n${result.out}\n${result.err}`);
  }
  return result.out;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`model did not return JSON:\n${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

async function askModel(discovery, correction) {
  const prompt = await readFile(join(root, "prompts/setup-host.md"), "utf8");
  const user = [
    "This is the container proof. The discover result was produced inside the container.",
    "Select plugins and copy validate commands exactly.",
    correction ? `Your previous answer was rejected: ${correction}` : "",
    JSON.stringify(discovery),
  ].filter(Boolean).join("\n\n");
  const response = await fetch(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`llama ${response.status}: ${body.slice(0, 500)}`);
  const parsed = JSON.parse(body);
  const text = parsed.choices?.[0]?.message?.content ?? "";
  return extractJson(text);
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

await run(containerBin, ["delete", "--force", name]);

const created = await run(containerBin, [
  "run", "-d", "--name", name, "--workdir", "/work",
  "--cpus", "2", "--memory", "2G",
  "--entrypoint", "sleep",
  "--mount", `type=bind,source=${root},target=/work`,
  image, "infinity",
]);
if (created.code !== 0) {
  console.error(created.out);
  console.error(created.err);
  process.exit(1);
}

try {
  const raw = await exec(["node", "bin/discover.mjs"]);
  const discovery = JSON.parse(raw);
  const expected = discovery.plugins.filter((plugin) => plugin.applicable && plugin.proofRequired);
  const expectedIds = expected.map((plugin) => plugin.id);
  const expectedValidate = expected.flatMap((plugin) => plugin.validate);
  let answer;
  let correction = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    answer = await askModel(discovery, correction);
    const plugins = answer.plugins ?? [];
    const validate = answer.validate ?? [];
    const idsOk = sameSet(plugins, expectedIds);
    const validateOk = validate.join("\n") === expectedValidate.join("\n");
    if (idsOk && validateOk) break;
    correction = `expected plugins ${JSON.stringify(expectedIds)} and validate ${JSON.stringify(expectedValidate)}, got ${JSON.stringify(answer)}`;
    if (attempt === 2) throw new Error(correction);
    console.error(`retry: ${correction}`);
  }
  console.log(JSON.stringify({ model, plugins: answer.plugins, validate: answer.validate }));
  for (const id of expectedIds) {
    await exec(["node", "bin/setup.mjs", id]);
    await exec(["node", "bin/check.mjs", id]);
    console.log(`validated ${id}`);
  }
  console.log("proof ok");
} finally {
  await run(containerBin, ["delete", "--force", name]);
}
