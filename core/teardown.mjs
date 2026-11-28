import { teardownPackage } from "./lib/lifecycle.mjs";

const result = await teardownPackage({ id: "core" });
console.log(JSON.stringify({ id: result.id, healthcheck: result.healthcheck, status: result.status, assetsChanged: result.assetsChanged }));
if (result.status !== "down" || result.assetsChanged) process.exit(1);
