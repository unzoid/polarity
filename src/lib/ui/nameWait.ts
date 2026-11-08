import { useEffect, useState } from "react";

/** How long a title's name stays unseen while its logo is still being worked out (#343): then it shows anyway. */
export const NAME_WAIT = 4000;

/**
 * Whether a title's name should still wait unseen: while `pending` (its logo isn't known yet), for at most
 * `NAME_WAIT` from when `key` (the title) started waiting, so a page is never left without a heading (#343).
 */
export function useNameWait(pending: boolean, key: string) {
  const [over, setOver] = useState<string>();
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setOver(key), NAME_WAIT);
    return () => clearTimeout(timer);
  }, [pending, key]);
  return pending && over !== key;
}
