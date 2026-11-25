const decoder = new TextDecoder();

export function createInterface() {
  let pending = "";
  let reader = null;
  return {
    async question(prompt) {
      globalThis.process.stdout.write(prompt);
      if (!reader) reader = tjs.stdin.getReader();
      while (!pending.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
      }
      const index = pending.indexOf("\n");
      const line = index === -1 ? pending : pending.slice(0, index);
      pending = index === -1 ? "" : pending.slice(index + 1);
      return line.replace(/\r$/, "");
    },
    close() {
      reader?.releaseLock?.();
      reader = null;
    },
  };
}

export default { createInterface };
