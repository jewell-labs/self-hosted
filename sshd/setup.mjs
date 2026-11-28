import { setupPackage } from "../core/lib/lifecycle.mjs";

const result = await setupPackage({ id: "sshd" });
console.log(JSON.stringify({ id: result.id, healthcheck: result.healthcheck, status: result.status }));
if (result.healthcheck !== "ok") process.exit(1);
