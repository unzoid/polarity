import { Suspense, useEffect, useState, type ReactNode } from "react";
import { LIMIT_NOTICE, useTitleVerdict, useViewingLimit } from "../lib/catalog";
import { isFileId } from "../lib/localFiles";
import { useMeta } from "../lib/net";
import { isLinkId } from "../lib/party";
import type { ContentType } from "../lib/types";
import { EmptyState } from "./ui/EmptyState";
import { appWindow } from "../lib/platform";
import { type Route, useNavigation } from "../lib/router";
import { forgetPlayerSourceChoices } from "../lib/playback";
import { lazyNamed, whenIdle } from "../lib/ui";
import { ErrorBoundary } from "./ui/ErrorBoundary";

/** How long the player layer takes to fade back to the page (matches player.css). */
export const PLAYER_EXIT_MS = 260;

/** Its own chunk, fetched once the app is idle (on fast connections) or when Detail/Play is reached so pressing Play never waits on it. */
const Player = lazyNamed(() => import("../screens/Player"), "Player");
export const preloadPlayerNow = () => void Player.preload().catch(() => {});
export const preloadPlayer = () => {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }) : undefined;
  const c = nav?.connection;
  if (c && (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g" || (c.downlink && c.downlink < 2.5))) {
    return () => {};
  }
  let cancelIdle: (() => void) | undefined;
  const later = window.setTimeout(() => {
    cancelIdle = whenIdle(() => void Player.preload().catch(() => {}), 5000);
  }, 4000);
  return () => {
    window.clearTimeout(later);
    cancelIdle?.();
  };
};

type PlayerRoute = Extract<Route, { name: "player" }>;

/**
 * Each opening of the player, a source picked in it included, is a route of its own (the router's `replace`), so
 * it gets a number of its own: the player remounts and starts the new pick (#393). Keyed by the link alone, a
 * torrent (no link) or the same source picked again after it failed kept the player as it was, and the pick did
 * nothing.
 */
const picks = new WeakMap<PlayerRoute, number>();
let nextPick = 0;
const pickOf = (route: PlayerRoute) => {
  let n = picks.get(route);
  if (n === undefined) picks.set(route, (n = nextPick++));
  return n;
};

/**
 * Which player to draw. It stays drawn for its exit fade after its route is
 * gone; the page beneath is already live, so leaving never waits on the
 * animation.
 */
export function usePlayerLayer(current: Route) {
  const playing = current.name === "player" ? current : null;
  const [shown, setShown] = useState<PlayerRoute | null>(playing);
  useEffect(() => {
    if (playing) return setShown(playing);
    const t = window.setTimeout(() => setShown(null), PLAYER_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [playing]);
  const player = playing ?? shown;
  return { playing, player, leaving: !playing && !!player };
}

/**
 * A title over the profile's viewing limit doesn't play, however it was started (Continue Watching, the Library, a
 * link): the player waits for its rating and, over the limit, never starts. Links and files on this device have
 * no title behind them and play as before.
 */
function PlayGate({ type, metaId, onBack, children }: { type: ContentType; metaId: string; onBack: () => void; children: ReactNode }) {
  const titled = !isLinkId(metaId) && !isFileId(metaId);
  const limited = useViewingLimit().limit !== null;
  const { data: meta, isError } = useMeta(type, metaId, titled && limited);
  const verdict = useTitleVerdict(meta, !!meta || isError);
  if (!titled || verdict === "show") return children;
  if (verdict === "wait") return null;
  return (
    <div className="player-limit">
      <EmptyState action={{ label: "Back", onClick: onBack }}>{LIMIT_NOTICE}</EmptyState>
    </div>
  );
}

/**
 * The full-window playback layer. It fades in and out once per visit; the
 * player inside it remounts per video *and* per source, so switching either
 * starts clean without the page flashing through.
 */
export function PlayerLayer({ player, leaving }: { player: PlayerRoute | null; leaving: boolean }) {
  // The filters you set in the player last as long as it stays open.
  const open = !!player;
  useEffect(() => {
    if (!open) forgetPlayerSourceChoices();
  }, [open]);
  // No status bar over the video (iOS), from the first frame until the exit fade starts; one
  // call per visit, not per episode.
  const watching = open && !leaving;
  useEffect(() => {
    if (!watching) return;
    void appWindow.setSystemBarsHidden(true);
    return () => void appWindow.setSystemBarsHidden(false);
  }, [watching]);
  const { back } = useNavigation();
  if (!player) return null;
  const key = `${player.videoId}|${pickOf(player)}`;
  return (
    <div className="player-layer" data-leaving={leaving} inert={leaving}>
      <ErrorBoundary key={key} where="player" action={{ label: "Back", onClick: back }}>
        <PlayGate type={player.type} metaId={player.metaId} onBack={back}>
          <Suspense fallback={null}>
            <Player
              type={player.type}
              metaId={player.metaId}
              videoId={player.videoId}
              stream={player.stream}
              shuffle={!!player.shuffle}
              startParty={!!player.startParty}
              leaving={leaving}
            />
          </Suspense>
        </PlayGate>
      </ErrorBoundary>
    </div>
  );
}
