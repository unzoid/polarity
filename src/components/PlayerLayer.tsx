import { Suspense, useEffect, useState } from "react";
import { appWindow } from "../lib/platform";
import { useRouter, type Route } from "../lib/router";
import { forgetPlayerSourceChoices } from "../lib/playback";
import { lazyNamed, whenIdle } from "../lib/ui";
import { ErrorBoundary } from "./ui/ErrorBoundary";

/** How long the player layer takes to fade back to the page (matches player.css). */
export const PLAYER_EXIT_MS = 260;

/** Its own chunk, fetched once the app is idle so pressing Play never waits on it. */
const Player = lazyNamed(() => import("../screens/Player"), "Player");
export const preloadPlayer = () => whenIdle(() => void Player.preload());

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
  const { back } = useRouter();
  if (!player) return null;
  const key = `${player.videoId}|${pickOf(player)}`;
  return (
    <div className="player-layer" data-leaving={leaving} inert={leaving}>
      <ErrorBoundary key={key} where="player" action={{ label: "Back", onClick: back }}>
        <Suspense fallback={null}>
          <Player
            type={player.type}
            metaId={player.metaId}
            videoId={player.videoId}
            stream={player.stream}
            shuffle={!!player.shuffle}
            leaving={leaving}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
