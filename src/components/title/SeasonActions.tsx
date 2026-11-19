import { useState } from "react";
import type { Meta, Video } from "../../lib/types";
import { BatchProgress, useBatchDownload } from "../BatchDownload";
import { Download, More, Shuffle, Star } from "../icons";
import { iconButtonClass } from "../ui/Button";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../ui/Menu";
import { EpisodeRatingsDialog, useEpisodeRatings } from "./EpisodeRatings";

/**
 * A season's actions in one menu beside its tabs: Download Season, Shuffle Episodes and, when enough episodes
 * are rated, Episode Ratings (a dialog over the page). A download under way shows its progress beside the menu.
 */
export function SeasonActions({
  meta,
  episodes,
  season,
  part,
  onShuffle,
  onOpenEpisode,
}: {
  meta: Meta;
  /** The season's episodes that can be downloaded. */
  episodes: Video[];
  season?: number;
  /** An episode order's group, instead of a season. */
  part?: number;
  onShuffle: () => void;
  /** A cell of the ratings chart: that episode, its sources listed. */
  onOpenEpisode: (v: Video) => void;
}) {
  const download = useBatchDownload({ item: meta, videos: episodes, season, part });
  const grid = useEpisodeRatings(meta.videos);
  const [ratings, setRatings] = useState(false);
  return (
    <>
      <BatchProgress download={download} />
      <MenuRoot>
        <MenuTrigger className={iconButtonClass("glass", "season-actions")} aria-label="Season Options" title="Season options">
          <More size={20} />
        </MenuTrigger>
        <MenuPopup aria-label="Season options" align="end">
          <MenuItem icon={<Download size={15} />} disabled={download.running || download.disabled} onClick={download.start}>
            {download.label}
          </MenuItem>
          <MenuItem icon={<Shuffle size={15} />} onClick={onShuffle}>
            Shuffle Episodes
          </MenuItem>
          {grid && (
            <MenuItem icon={<Star size={15} />} onClick={() => setRatings(true)}>
              Episode Ratings
            </MenuItem>
          )}
        </MenuPopup>
      </MenuRoot>
      {grid && <EpisodeRatingsDialog grid={grid} title={meta.name} open={ratings} onClose={() => setRatings(false)} onOpen={onOpenEpisode} />}
    </>
  );
}
