import { Skeleton } from "../ui/Skeleton";

/**
 * A title page's hero while its parts come in (`useReadyTogether`): the logo's block, the synopsis's lines, the
 * facts line and the actions, where each will be, then the whole hero at once. Inside the hero it sits over the
 * (hidden) content, at its foot; before there's anything to show at all, `DetailPending` draws the page with it.
 */
export function HeroSkeleton() {
  return (
    <div className="hero-skeleton" aria-hidden>
      <Skeleton className="hero-skeleton-logo" />
      <div className="hero-skeleton-lines">
        <Skeleton shape="line" width="100%" />
        <Skeleton shape="line" width="94%" />
        <Skeleton shape="line" width="58%" />
      </div>
      <Skeleton shape="line" width="38%" />
      <div className="hero-skeleton-actions">
        <Skeleton className="hero-skeleton-play" />
        <Skeleton className="hero-skeleton-round" />
        <Skeleton className="hero-skeleton-round" />
      </div>
    </div>
  );
}

/** A title page before even its name is known (opened from a link): the hero's skeleton where the hero goes. */
export function DetailPending() {
  return (
    <div className="detail detail-pending" aria-busy="true" aria-label="Loading">
      <div className="scroll detail-scroll">
        <section className="detail-hero" data-ready="false">
          <div className="detail-hero-main">
            <HeroSkeleton />
          </div>
        </section>
      </div>
    </div>
  );
}
