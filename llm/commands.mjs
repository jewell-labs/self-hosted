import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { selectLlmProfile } from "../lib/profiles.mjs";

export async function setup(ctx) {
  const profile = selectLlmProfile(ctx.host);
  const rendered = {
    profile: profile.id,
    port: profile.port,
    args: profile.args,
    modelsDir: ctx.host.llmModels,
  };
  const dest = await ctx.writeState("llm.json", `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${dest} profile=${profile.id}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "llm.json"), "utf8"));
  if (written.profile !== ctx.discovery.llmProfile?.id || written.args.join(" ") !== ctx.discovery.llmProfile.args.join(" ")) {
    console.error("llm.json does not match the selected profile");
    process.exit(1);
  }
  console.log(`llm ok profile=${written.profile}`);
}
