import { createHash as makeHash } from "tjs:hashing";

export function createHash(algorithm) {
  const hash = makeHash(algorithm);
  return {
    update(data) {
      hash.update(data);
      return this;
    },
    digest(encoding = "hex") {
      return hash.digest(encoding);
    },
  };
}

export default { createHash };
