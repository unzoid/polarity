import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { storeLocal } from "../errors";
import { isRecord, storedJson } from "../parse";
import { orderView, type EpisodeOrderInfo, type OrderView } from "./episodeOrder";
import type { Meta } from "../types";

/**
 * Which episode order each show is watched in (episodeOrder.ts), on this device only: a small
 * localStorage map of show id → order id, the most recently chosen {@link KEEP} kept. A show missing
 * from it is watched as aired.
 */

const STORAGE = "polar.episodeOrders";
/** Shows remembered at most; the least recently chosen go first. */
export const KEEP = 300;

type Chosen = Record<string, { order: string; at: number }>;

/** A stored map, keeping only well-formed entries. */
export function readChosen(v: unknown): Chosen {
  if (!isRecord(v)) return {};
  const out: Chosen = {};
  for (const [id, e] of Object.entries(v)) {
    if (isRecord(e) && typeof e.order === "string" && typeof e.at === "number") out[id] = { order: e.order, at: e.at };
  }
  return out;
}

/** `chosen` with `metaId` set to `order` (or back to as aired with null), at most `keep` shows. */
export function withChoice(chosen: Chosen, metaId: string, order: string | null, at: number, keep = KEEP): Chosen {
  const next = { ...chosen };
  delete next[metaId];
  if (order) next[metaId] = { order, at };
  const ids = Object.keys(next);
  if (ids.length <= keep) return next;
  const kept = ids.sort((a, b) => next[b].at - next[a].at).slice(0, keep);
  return Object.fromEntries(kept.map((id) => [id, next[id]]));
}

let chosen: Chosen = readChosen(storedJson(globalThis.localStorage, STORAGE));
const listeners = new Set<() => void>();

export const chosenOrder = (metaId: string): string | null => chosen[metaId]?.order ?? null;

export function chooseOrder(metaId: string, order: string | null) {
  chosen = withChoice(chosen, metaId, order, Date.now());
  storeLocal(STORAGE, JSON.stringify(chosen));
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useChosenOrder = (metaId: string) => useSyncExternalStore(subscribe, () => chosenOrder(metaId));

export interface EpisodeOrders {
  /** The orders TMDB lists for the show; empty without a TMDB key, or for a show with none. */
  orders: EpisodeOrderInfo[];
  /** The chosen one's id, null for as aired. */
  chosen: string | null;
  choose: (order: string | null) => void;
  /** The chosen order over the show's episodes, once loaded; undefined while as aired. */
  view?: OrderView;
}

const canOrder = (meta?: Meta) => !!meta && meta.type === "series" && meta.id.startsWith("tt") && meta.videos.length > 0;

/** A series' episode orders and the one chosen for it, for its page and the player. */
export function useEpisodeOrders(meta?: Meta): EpisodeOrders {
  const metaId = meta?.id ?? "";
  const picked = useChosenOrder(metaId);
  const enabled = canOrder(meta);
  const { data: orders } = useQuery({
    queryKey: ["episode-orders", metaId],
    queryFn: () => api.episodeOrders(metaId),
    enabled,
    staleTime: 6 * 60 * 60_000,
  });
  // A choice TMDB no longer lists (or without a key now) falls back to as aired.
  const chosen = picked && orders?.some((o) => o.id === picked) ? picked : null;
  const { data: order } = useQuery({
    queryKey: ["episode-order", metaId, chosen],
    queryFn: () => api.episodeOrder(metaId, chosen!),
    enabled: enabled && !!chosen,
    staleTime: 6 * 60 * 60_000,
  });
  const videos = meta?.videos;
  const view = useMemo(() => (chosen && order && order.id === chosen && videos ? orderView(order, videos) : undefined), [chosen, order, videos]);
  return { orders: enabled ? (orders ?? []) : [], chosen, choose: (o) => chooseOrder(metaId, o), view };
}
