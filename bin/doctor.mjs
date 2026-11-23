import { doctor } from "../lib/doctor.mjs";

const level = process.argv[2];
if (process.argv.length > 3) {
  console.error("usage: node bin/doctor.mjs [shape|mesh|repos|strict]");
  process.exit(2);
}

try {
  const report = await doctor(process.env, level ? { level } : {});
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
