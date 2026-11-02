/** Small deterministic PRNG so the mock data set is reproducible. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!;
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const chance = (p: number) => next() < p;
  return { next, int, pick, shuffle, chance };
}

export type Rng = ReturnType<typeof createRng>;
