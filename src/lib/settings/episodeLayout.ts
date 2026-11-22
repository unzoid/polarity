import { useSettings, useUpdateSettings } from "../net/queries";
import type { EpisodeLayout } from "../types";

/**
 * Episodes side by side or as a list (#226): one choice for the title pages and the player, so switching it in one
 * place switches it everywhere, and it's remembered.
 */
export function useEpisodeLayout(): [EpisodeLayout, (layout: EpisodeLayout) => void] {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const value = data?.episodeLayout === "list" ? "list" : "row";
  return [value, (episodeLayout: EpisodeLayout) => update.mutate({ episodeLayout })];
}
