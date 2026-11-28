const custom = Symbol.for("nodejs.util.promisify.custom");

export function promisify(fn) {
  if (typeof fn?.[custom] === "function") return fn[custom].bind(fn);
  return (...args) => new Promise((resolve, reject) => {
    fn(...args, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

export { custom };
export default { promisify };
