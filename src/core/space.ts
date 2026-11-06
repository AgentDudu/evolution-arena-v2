export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Reflect a coordinate off a wall of thickness margin and flip its velocity component.
 *  Returns the corrected position; the caller writes back the sign-flipped velocity. */
export function bounce(pos: number, limit: number, radius: number): number {
  const hi = limit - radius;
  const lo = radius;
  if (pos < lo) return lo + (lo - pos);
  if (pos > hi) return hi - (pos - hi);
  return pos;
}

export function wrap(pos: number, limit: number): number {
  if (pos < 0) return pos + limit;
  if (pos >= limit) return pos - limit;
  return pos;
}
