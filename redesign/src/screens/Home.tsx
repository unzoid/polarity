import { useMemo, useState } from "react";
import { useEntryShown } from "../../../src/lib/anime";
import {
  catalogKey,
  catalogTitle,
  progressItem,
  shelfKey,
  shelfRoute,
  todaysShelves,
  useAddonCatalogRow,
  useBrowseFeatured,
  useBrowseShelf,
  useBrowseVisible,
  useFeatured,
  useHomeCatalogs,
  useListable,
  useSeeds,
  useShownAbove,
  type AddonCatalog,
  type Shelf,
} from "../../../src/lib/catalog";
import { useCatalog, useContinueWatching, useMeta, useRecommend, useSettings } from "../../../src/lib/net";
import { useNavigation } from "../../../src/lib/router";
import { runtimeSeconds } from "../../../src/lib/format";
import { useFormFactor, useNearViewport } from "../../../src/lib/ui";
import type { MetaPreview, Progress } from "../../../src/lib/types";
import { Art } from "../ui/Art";
import { Button } from "../ui/Button";
import { PosterCard, ResumeCard, StillCard } from "../ui/Cards";
import { Rail, RailSkeleton } from "../ui/Rail";
import { RunLine } from "../ui/RunLine";
import { SaveButton } from "../ui/SaveButton";
import { formatRuntimeLong, yearOf } from "../ui/time";

const NO_TITLES: MetaPreview[] = [];
/** The first rails load straight away; the rest when they come near. */
const EAGER_SHELVES = 2;
/** With fewer new titles than this, a rail shows its whole list, repeats and all. */
const MIN_FRESH = 6;

/**
 * Home, top to bottom: today's featured title with the rest of today's programme beside it, what you're part-way
 * through, your add-ons' catalogs, then the day's rails. Nothing moves on its own.
 */
export function Home() {
  const featured = useBrowseFeatured(useFeatured().data);
  const seeds = useSeeds();
  const shelves = useMemo(() => todaysShelves(seeds), [seeds]);
  const shownAbove = useShownAbove(shelves, featured ?? NO_TITLES);
  const { data: watching } = useContinueWatching();
  const watched = useMemo(() => new Set((watching ?? []).map((p) => p.metaId)), [watching]);
  const { data: settings } = useSettings();
  const addonRows = useHomeCatalogs();

  return (
    <div className="scroll home page-enter">
      <Feature items={featured} />
      <div className="home-rails">
        {(settings?.showContinueWatching ?? true) && <ContinueRail />}
        {addonRows.map((c) => (
          <AddonRail key={catalogKey(c)} catalog={c} />
        ))}
        {shelves.map((shelf, i) => (
          <LazyRail
            key={shelfKey(shelf).join("/")}
            shelf={shelf}
            eager={i < EAGER_SHELVES}
            exclude={shelf.kind === "because" ? new Set([...shownAbove[i], ...watched]) : shownAbove[i]}
          />
        ))}
      </div>
    </div>
  );
}

// --- Today's programme --------------------------------------------------------

/**
 * One featured title, its art filling the top of the page, and the rest of today's featured titles listed beside it
 * like the night's programme. Picking one shows it; nothing advances by itself. Which one leads changes with the day.
 */
function Feature({ items }: { items?: MetaPreview[] }) {
  const day = Math.floor(Date.now() / 86_400_000);
  const [picked, setPicked] = useState<string | null>(null);
  const phone = useFormFactor().form === "phone";
  if (!items) return <div className="feature feature-pending" aria-hidden />;
  if (!items.length) return <div className="feature-none" />;
  const lead = items[day % items.length];
  const item = items.find((i) => i.id === picked) ?? lead;
  // Today's list starts with the lead and runs on from it.
  const start = items.indexOf(lead);
  const programme = [...items.slice(start), ...items.slice(0, start)];

  return (
    <section className="feature" aria-label="Featured today">
      <div className="feature-art" key={item.id}>
        <Art sources={[item.background, item.poster]} loading="eager" />
      </div>
      <div className="feature-scrim" />
      <FeatureText item={item} />
      {!phone && programme.length > 1 && (
        <aside className="programme" aria-label="Also featured today">
          <p className="programme-label">Today</p>
          <ol>
            {programme.map((p) => (
              <li key={p.id}>
                <button className="programme-row" aria-current={p.id === item.id ? "true" : undefined} onClick={() => setPicked(p.id)}>
                  <span className="programme-name">{p.name}</span>
                  <span className="t-mono faint">
                    {[p.type === "series" ? "Series" : "Film", yearOf(p.releaseInfo)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </section>
  );
}

function FeatureText({ item }: { item: MetaPreview }) {
  const { navigate } = useNavigation();
  const { data: meta } = useMeta(item.type, item.id);
  const length = runtimeSeconds(meta?.runtime);
  const facts = [item.type === "series" ? "Series" : "Film", yearOf(item.releaseInfo), ...(item.genres ?? []).slice(0, 2)].filter(Boolean);
  return (
    <div className="feature-text on-art">
      <p className="t-mono feature-facts">{facts.join(" · ")}</p>
      <h1 className="t-display">{item.name}</h1>
      {length > 0 && (
        <div className="feature-run">
          <RunLine length={length} />
          <span className="t-mono">{item.type === "series" ? `${formatRuntimeLong(length)} an episode` : formatRuntimeLong(length)}</span>
        </div>
      )}
      {item.description && <p className="feature-description clamp-3">{item.description}</p>}
      <div className="feature-actions">
        <Button kind="primary" size="large" onClick={() => navigate({ name: "detail", type: item.type, id: item.id, preview: item })}>
          {item.type === "series" ? "See episodes" : "Watch"}
        </Button>
        <SaveButton item={item} size="large" />
      </div>
    </div>
  );
}

// --- Continue watching ---------------------------------------------------------

function ContinueRail() {
  const { data } = useContinueWatching();
  if (!data?.length) return null;
  return (
    <Rail title="Continue watching" kind="still">
      {data.map((p) => (
        <ResumeItem key={p.videoId} progress={p} />
      ))}
    </Rail>
  );
}

/** An anime watched as separate seasons opens the entry the episode belongs to (lib/anime). */
function ResumeItem({ progress }: { progress: Progress }) {
  const stored = useMemo(() => progressItem(progress), [progress]);
  const { item, opens } = useEntryShown(stored, progress.videoId);
  return <ResumeCard progress={progress} name={item.name} opens={opens} />;
}

// --- Rails ---------------------------------------------------------------------

function CatalogRail({ shelf, enabled, exclude }: { shelf: Shelf; enabled: boolean; exclude: Set<string> }) {
  const phone = useFormFactor().form === "phone";
  const shape = phone ? "poster" : shelf.shape;
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isLoading, isError } = isCatalog ? catalog : recommended;
  const { navigate } = useNavigation();
  const to = shelfRoute(shelf);
  const shown = useBrowseShelf(useListable(data), isCatalog ? { type: shelf.type, id: shelf.id, genre: shelf.genre } : undefined);
  const items = useMemo(() => {
    const fresh = (shown ?? []).filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : (shown ?? []);
  }, [shown, exclude, shelf.kind]);

  if (isError) return null;
  if (shelf.kind === "because" && data && items.length < 4) return null;
  const kind = shape === "landscape" ? "still" : "poster";
  if (isLoading || !enabled) {
    return (
      <section className="rail">
        <div className="section section-head">
          <h2 className="t-section">{shelf.title}</h2>
        </div>
        <RailSkeleton kind={kind} />
      </section>
    );
  }
  return (
    <Rail title={shelf.title} kind={kind} onSeeAll={to && (() => navigate(to))}>
      {items.map((item) => (kind === "still" ? <StillCard key={item.id} item={item} /> : <PosterCard key={item.id} item={item} />))}
    </Rail>
  );
}

function LazyRail({ shelf, eager, exclude }: { shelf: Shelf; eager: boolean; exclude: Set<string> }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(eager);
  return (
    <div ref={ref}>
      <CatalogRail shelf={shelf} enabled={near} exclude={exclude} />
    </div>
  );
}

/** One of your add-ons' catalogs: fetched when near, left out when it fails or has nothing. */
function AddonRail({ catalog }: { catalog: AddonCatalog }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { data: found, isError } = useAddonCatalogRow(catalog, near);
  const data = useBrowseVisible(useListable(found));
  const { navigate } = useNavigation();
  return (
    <div ref={ref}>
      {!isError && !(data && !data.length) && (
        <Rail
          title={catalogTitle(catalog)}
          onSeeAll={() => navigate({ name: "discover", type: catalog.type, catalog: catalog.id, addon: catalog.addon })}
        >
          {data ? data.map((item) => <PosterCard key={item.id} item={item} />) : null}
        </Rail>
      )}
    </div>
  );
}
