import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { realInside } from "../../lib/jail.mjs";
import { homeDir, layout } from "../../lib/paths.mjs";

export async function setup(ctx) {
  const dir = layout().containers;
  const store = await realInside(homeDir(), dir);
  await mkdir(store, { recursive: true });
  const unit = {
    appRoot: dir,
    env: "CONTAINER_APP_ROOT",
    note: "Start Apple container services with --app-root set to appRoot. The Application Support path is not the store.",
  };
  const dest = await ctx.writeState("containers.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "containers.json"), "utf8"));
  const dir = layout().containers;
  if (written.appRoot !== dir || written.env !== "CONTAINER_APP_ROOT") {
    console.error(`containers store is not ${dir}`);
    process.exit(1);
  }
  console.log("containers ok");
}
