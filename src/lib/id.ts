let counter = 0;

/** Short, collision-resistant enough for a local-first single-household app. */
export function uid(prefix = 'x'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
