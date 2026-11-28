import { Buffer } from "./buffer.js";

class Emitter {
  constructor() {
    this._events = new Map();
  }
  on(name, fn) {
    const list = this._events.get(name) ?? [];
    list.push(fn);
    this._events.set(name, list);
    return this;
  }
  once(name, fn) {
    const wrap = (...args) => {
      this.off(name, wrap);
      fn(...args);
    };
    return this.on(name, wrap);
  }
  off(name, fn) {
    this._events.set(name, (this._events.get(name) ?? []).filter((item) => item !== fn));
    return this;
  }
  emit(name, ...args) {
    for (const fn of [...(this._events.get(name) ?? [])]) fn(...args);
  }
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(String(value ?? ""));
}

function settle(value) {
  if (value && typeof value.catch === "function") value.catch(() => {});
}

function wrapOpened(opened) {
  const socket = new Emitter();
  socket.destroyed = false;
  const reader = opened.readable.getReader();
  const writer = opened.writable.getWriter();
  socket.write = (chunk) => {
    writer.write(bytes(chunk)).catch((error) => socket.emit("error", error));
    return true;
  };
  socket.destroy = () => {
    if (socket.destroyed) return;
    socket.destroyed = true;
    settle(reader.cancel());
    settle(writer.close());
  };
  socket.pipe = (dest) => {
    socket.on("data", (chunk) => dest.write(chunk));
    socket.on("close", () => dest.destroy?.());
    return dest;
  };
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.emit("data", Buffer.from(value));
      }
    } catch (error) {
      if (!socket.destroyed) socket.emit("error", error);
    }
    socket.emit("close");
  })();
  return socket;
}

export function createServer(onConnection) {
  const server = new Emitter();
  let listener = null;
  let reader = null;
  server._open = false;
  server.listen = (port, host, callback) => {
    let listenHost = host;
    let cb = callback;
    if (typeof host === "function") {
      cb = host;
      listenHost = "127.0.0.1";
    }
    try {
      listener = new TCPServerSocket(listenHost ?? "127.0.0.1", { port: Number(port) });
    } catch (error) {
      queueMicrotask(() => server.emit("error", error));
      return server;
    }
    listener.opened.then(async (opened) => {
      server.address = () => ({ port: opened.localPort, address: opened.localAddress, family: "IPv4" });
      server._open = true;
      reader = opened.readable.getReader();
      if (cb) cb();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done || !server._open) break;
          const openedSocket = await next.value.opened;
          onConnection?.(wrapOpened(openedSocket));
        }
      } catch (error) {
        if (server._open) server.emit("error", error);
      }
    }).catch((error) => server.emit("error", error));
    return server;
  };
  server.close = (callback) => {
    server._open = false;
    const stop = async () => {
      if (reader) await Promise.resolve(reader.cancel()).catch(() => {});
      if (listener?.close) await Promise.resolve(listener.close()).catch(() => {});
    };
    stop().finally(() => { if (callback) callback(); });
    return server;
  };
  server.address = () => null;
  return server;
}

export function connect(options, callback) {
  const socket = new Emitter();
  socket.destroyed = false;
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port);
  let tcp = null;
  const timer = options.timeout ? setTimeout(() => socket.emit("timeout"), options.timeout) : null;
  try {
    tcp = new TCPSocket(host, port);
  } catch (error) {
    queueMicrotask(() => socket.emit("error", error));
    return socket;
  }
  tcp.opened.then((opened) => {
    if (timer) clearTimeout(timer);
    const live = wrapOpened(opened);
    socket.write = live.write;
    socket.destroy = () => {
      socket.destroyed = true;
      live.destroy();
      settle(tcp.close?.());
    };
    socket.pipe = (dest) => live.pipe(dest);
    live.on("data", (chunk) => socket.emit("data", chunk));
    live.on("close", () => socket.emit("close"));
    live.on("error", (error) => socket.emit("error", error));
    socket.emit("connect");
    if (callback) callback();
  }).catch((error) => {
    if (timer) clearTimeout(timer);
    socket.emit("error", error);
  });
  socket.destroy = () => {
    socket.destroyed = true;
    if (timer) clearTimeout(timer);
    settle(tcp?.close?.());
  };
  socket.write = () => false;
  return socket;
}

export default { createServer, connect };
