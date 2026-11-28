import { uninstallSelf } from "../core/lib/uninstall.mjs";

const result = uninstallSelf(import.meta.url);
if (result.status !== 0) {
  console.error(result.message);
  process.exit(result.status);
}
console.log(result.message);
