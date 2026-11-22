import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { prefetchTitlePage, useEntryShown } from "../lib/anime";
import { api } from "../lib/api";
import { progressItem } from "../lib/catalog";
import { episodeCode, formatRemaining, joinFacts } from "../lib/format";
import { dismissUpNext, removeContinueEntries, useUpNextContinueWatching, type ContinueEntry } from "../lib/library";
import { keys } from "../lib/net";
import { useNavigation } from "../lib/router";
import { cardMenu } from "./CardMenu";
import { ContinueEditRow } from "./ContinueEditRow";
import { Play } from "./icons";
import { ArtTitle, Card, ProgressBar } from "./title/Card";

export function ContinueRow() {
  const entries = useUpNextContinueWatching();
  const items = useMemo(() => entries.map((e) => e.progress), [entries]);
  const byVideo = useMemo(() => new Map(entries.map((e) => [e.progress.videoId, e])), [entries]);
  const order = useMemo(() => items.map((p) => p.videoId).join(" "), [items]);
  if (!entries.length) return null;
  // Edit picks several cards to remove at once (components/ContinueEditRow.tsx).
  return (
    <ContinueEditRow
      items={items}
      order={order}
      remove={(selected) => removeContinueEntries(selected.map((p) => byVideo.get(p.videoId) ?? { progress: p }))}
      card={(p) => <ContinueCard entry={byVideo.get(p.videoId) ?? { progress: p }} />}
    />
  );
}

/**
 * Continue Watching card: clicking the play button resumes (or starts the next episode) straight away;
 * clicking anywhere else on the card opens the title's page.
 * With seasons as separate shows, an anime shows the entry the episode is part of (#22).
 */
function ContinueCard({ entry: cw }: { entry: ContinueEntry }) {
  const { progress: p, upNext } = cw;
  const { navigate } = useNavigation();
  const stored = useMemo(() => progressItem(p), [p]);
  const { item, entry, opens } = useEntryShown(stored, p.videoId);
  // Which page it opens on is known before the menu is used (mostly a stored anime link: no network).
  useEffect(() => prefetchTitlePage(p.type, opens), [p.type, opens]);
  const open = () => navigate({ name: "detail", type: p.type, id: opens, preview: opens === item.id ? item : undefined });
  // The player goes on with the saved source only while the add-ons still offer it (#394).
  const resume = () => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId });
  const fraction = p.duration ? p.position / p.duration : 0;
  const remaining = formatRemaining(p.position, p.duration);
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;
  const artChain = useMemo(
    () => [p.background, meta.data?.background, p.poster, meta.data?.poster].filter((u, i, a): u is string => !!u && a.indexOf(u) === i),
    [p.background, meta.data?.background, p.poster, meta.data?.poster],
  );
  const captionTitle = entry
    ? `Episode ${entry.number} · ${p.episodeTitle ?? item.name}`
    : p.season != null
      ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}`
      : joinFacts(["Movie", meta.data?.releaseInfo]);

  return (
    <Card
      shape="landscape"
      frameClass="card-frame-resume"
      art={artChain[0]}
      artFallbacks={artChain.slice(1)}
      fallback={<span className="card-fallback t-headline">{item.name}</span>}
      title={captionTitle}
      // Always shown: it's what you're watching, not a description.
      keepCaption
      onClick={open}
      actions={
        <button
          type="button"
          className="card-play"
          aria-label={upNext ? `Play next episode of ${item.name}` : `Resume ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            resume();
          }}
        >
          <Play size={20} fill="currentColor" />
        </button>
      }
      {...cardMenu(stored, p, upNext ? { onRemoveContinue: () => dismissUpNext([cw]) } : undefined)}
    >
      {/* The logo names the show; an entry of it goes by its own name. */}
      <ArtTitle name={item.name} logo={entry ? undefined : logo} pending={!entry && meta.isLoading} />
      {/* Where you are, on the picture like Apple TV's: a bar and the time left, or Up Next (#38). */}
      <div className="card-resume">
        {upNext ? (
          <span className="card-resume-upnext">Up Next</span>
        ) : (
          <>
            <ProgressBar fraction={fraction} />
            {remaining && <span className="card-resume-left tabular">{remaining}</span>}
          </>
        )}
      </div>
    </Card>
  );
}
