import { buildDiscovery } from "../lib/discover.mjs";

process.stdout.write(`${JSON.stringify(buildDiscovery(), null, 2)}\n`);
