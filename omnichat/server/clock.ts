let lastTs = 0;

/** Monotonic millisecond clock used for sync cursors. */
export function now(): number {
  const t = Date.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}
