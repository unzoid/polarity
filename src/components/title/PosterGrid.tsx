import type { ReactNode } from "react";
import { CardSkeleton } from "./Card";
import { useInfiniteSentinel, useTogether, type Pager } from "../../lib/ui";

/**
 * The grid of poster cards (docs/ui-components.md U3). With a `pager` (an infinite query) it shows skeletons
 * while a page loads and asks for the next one before the end comes into view. `stale` dims the grid while
 * it still shows the previous query's cards.
 */
export function PosterGrid({ children, pager, stale, skeletons = 12 }: { children: ReactNode; pager?: Pager; stale?: boolean; skeletons?: number }) {
  const sentinel = useInfiniteSentinel<HTMLDivElement>(pager);
  // The first screen of posters comes in as one (lib/ui/together.ts); later pages fade in as they load.
  const together = useTogether();
  return (
    <>
      <div className="poster-grid" data-stale={stale || undefined} {...together}>
        {children}
        {pager && (pager.isLoading || pager.isFetchingNextPage) && Array.from({ length: skeletons }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </div>
      {pager && <div ref={sentinel} />}
    </>
  );
}
