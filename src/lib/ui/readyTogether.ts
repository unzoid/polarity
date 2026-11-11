import { useEffect, useState } from "react";

/**
 * How long a page holds its content back for its slowest part before it shows what it has. Past it, what was
 * missing comes in on its own (softly); before it, the page shows its skeleton and then everything at once.
 */
export const TOGETHER_BUDGET = 2500;

/**
 * Whether a page's parts may show (premium pages load together: the art, the logo, the text and the scores come
 * in as one, never piece by piece). True once `settled` (every part is in), or `budget` after `key` (the page's
 * subject) started waiting. Once true for a key it stays true, so a part refetching later never brings the
 * skeleton back. A page whose parts were all in already (going back to it) is ready on its first render.
 */
export function useReadyTogether(settled: boolean, key: string, budget = TOGETHER_BUDGET) {
  const [shown, setShown] = useState<string>();
  const [late, setLate] = useState<string>();
  const ready = settled || late === key || shown === key;
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setLate(key), budget);
    return () => clearTimeout(timer);
  }, [ready, key, budget]);
  useEffect(() => {
    if (ready && shown !== key) setShown(key);
  }, [ready, key, shown]);
  return ready;
}
