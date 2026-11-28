const EVERY = { "1h": 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000, "3d": 3 * 24 * 60 * 60 * 1000 };

export function due(every, last, now) {
  const span = EVERY[every];
  if (!span) throw new Error(`unknown every ${every}`);
  if (!last) return true;
  const then = Date.parse(last);
  return Number.isFinite(then) && now - then >= span;
}
