import { repoRoot } from "../lib/discover.mjs";
import { discoverHarnesses } from "./harnesses.mjs";
import { cleanWork, createWork, listWork } from "./store.mjs";
import { runHarness } from "./harness.mjs";

function fail(error) {
  return { text: error instanceof Error ? error.message : String(error), isError: true };
}

export async function workList(env) {
  try {
    return { text: JSON.stringify(await listWork(env)), isError: false };
  } catch (error) {
    return fail(error);
  }
}

export async function workCreate(args, env) {
  try {
    const created = await createWork({
      project: args.project,
      harness: args.harness,
      domain: args.domain,
      slug: args.slug,
      branch: args.branch,
    }, env);
    return { text: JSON.stringify(created), isError: false };
  } catch (error) {
    return fail(error);
  }
}

export async function workClean(env) {
  try {
    return { text: JSON.stringify(await cleanWork(env)), isError: false };
  } catch (error) {
    return fail(error);
  }
}

export async function harnessList(env) {
  try {
    return { text: JSON.stringify({ harnesses: await discoverHarnesses(env.SELFHOST_ROOT ?? repoRoot()) }), isError: false };
  } catch (error) {
    return fail(error);
  }
}

export async function harnessRun(args, env, hooks = {}) {
  try {
    return await runHarness(args, env, {
      onEvent(event) {
        try {
          hooks.bus?.publish(event);
        } catch {
          // The harness keeps running when a subscriber is gone.
        }
      },
    });
  } catch (error) {
    return fail(error);
  }
}
