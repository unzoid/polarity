import { useEffect, useRef, useState, type ReactNode } from "react";
import { endParty, expectedPosition, leaveParty, partyLog, partyRoute, setQuiet, setRules, syncNow, type PartyState, type RoomRules } from "../../lib/party";
import { formatTime } from "../../lib/format";
import { useMeta } from "../../lib/net";
import { osName } from "../../lib/platform";
import { useRouter } from "../../lib/router";
import { appVersion } from "../../lib/updater";
import { ChevronLeft, ChevronRight, Lock, LogIcon, Pause, Play, Power, Settings, SignOut } from "../icons";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { FitHeight, backOnEscape, useViewSlide } from "../ViewStack";
import { PartyCodeChip, PartyInvite, PartyMembers } from "./PartyUI";

/**
 * The party menu (#156): the top bar's party faces open it as a popover. Two pages, so the one opened most
 * stays short: the room (what's on and going there, who's here, the code, leaving), and its settings (sounds,
 * the host's rules, the log, ending it), a row away, with Back (and Escape) to the room. The player's Watch
 * Party panel and TV mode show the same parts in two columns (PartyRoomPane, PartySettingsPane).
 */
export function PartyMenu({ party, onClose }: { party: PartyState; onClose?: () => void }) {
  const [page, setPage] = useState<"room" | "settings">("room");
  const slide = useViewSlide(true, page, "room");
  // Keyboard focus follows the page: into the settings, back to the row that opened them.
  const pageRef = useRef<HTMLDivElement>(null);
  const turned = useRef(false);
  useEffect(() => {
    if (!turned.current) return;
    pageRef.current?.querySelector<HTMLElement>(page === "room" ? ".party-menu-settings" : ".party-menu-back")?.focus({ preventScroll: true });
  }, [page]);
  const go = (to: typeof page) => {
    turned.current = true;
    setPage(to);
  };
  return (
    <FitHeight>
      <div
        key={page}
        ref={pageRef}
        className="party-menu"
        data-page={page}
        data-slide={slide}
        onKeyDown={page === "settings" ? backOnEscape(() => go("room")) : undefined}
      >
        {page === "room" ? <PartyMenuRoom party={party} onClose={onClose} settings={() => go("settings")} /> : <PartyMenuSettings party={party} back={() => go("room")} />}
      </div>
    </FitHeight>
  );
}

function PartyMenuRoom({ party, onClose, settings }: { party: PartyState; onClose?: () => void; settings: () => void }) {
  const host = party.hostId === party.me;
  const on = ruleRows(party.rules).filter((r) => r.checked).length;
  return (
    <>
      {party.playback?.media && (
        <div className="party-menu-hero">
          <PartyNowPlaying party={party} backdrop />
          <PartyStreamButtons party={party} onGo={onClose} />
        </div>
      )}
      <section className="party-menu-section" aria-label="Members">
        <h3 className="party-kicker">Watching · {party.members.length}</h3>
        <PartyMembers party={party} />
      </section>
      <section className="party-menu-section" aria-label="Invite">
        <PartyCodeChip party={party} />
      </section>
      <section className="party-menu-section party-menu-rows">
        <button className="party-menu-row party-menu-settings" onClick={settings}>
          <Settings size={18} />
          <span>Party Settings</span>
          {host && <span className="party-menu-row-detail">{on} on</span>}
          <ChevronRight size={16} aria-hidden />
        </button>
        <button className="party-menu-row party-menu-leave" onClick={leaveParty}>
          <SignOut size={18} />
          <span>Leave Party</span>
        </button>
      </section>
    </>
  );
}

function PartyMenuSettings({ party, back }: { party: PartyState; back: () => void }) {
  const host = party.hostId === party.me;
  return (
    <>
      <button className="party-menu-back pressable" onClick={back}>
        <ChevronLeft size={18} strokeWidth={2.25} /> Watch Party
      </button>
      <section className="party-menu-group">
        <h3 className="party-kicker">Sound</h3>
        <PartyQuiet party={party} />
      </section>
      {host && (
        <section className="party-menu-group">
          <h3 className="party-kicker">Host controls</h3>
          <PartyRules party={party} />
        </section>
      )}
      <section className="party-menu-section">
        <div className="party-buttons">
          <PartyCopyLog />
          {host && <PartyEnd />}
        </div>
      </section>
    </>
  );
}

/**
 * The Watch Party panel's left column (the player's, and TV mode's with `now`):
 * what's on, the code to share, who's here, and getting back in step or out.
 * Sections stacked, a hairline between.
 */
export function PartyRoomPane({ party, onGo, now, autoFocus }: { party: PartyState; onGo?: () => void; now?: boolean; autoFocus?: boolean }) {
  return (
    <div className="party-column">
      {now && party.playback?.media && (
        <section>
          <PartyNowPlaying party={party} />
        </section>
      )}
      <section>
        <PartyInvite party={party} leave={false} autoFocus={autoFocus} />
      </section>
      <section aria-label="Members">
        <h3 className="party-kicker">Watching · {party.members.length}</h3>
        <PartyMembers party={party} />
      </section>
      <section>
        <div className="party-buttons">
          <PartyStreamButtons party={party} onGo={onGo} />
          <Button variant="glass" onClick={leaveParty}>
            Leave Party
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * The player's Watch Party panel, right column: every switch in one list (the
 * host's rules under the sound one), putting a link on, and the rarer actions last.
 */
export function PartySettingsPane({ party, link }: { party: PartyState; link?: ReactNode }) {
  const host = party.hostId === party.me;
  return (
    <div className="party-column">
      <section>
        <PartyQuiet party={party} />
        {host && <PartyRules party={party} />}
      </section>
      {link && (
        <section>
          <h3 className="party-kicker">Watch a link</h3>
          <p className="party-lede">Put a YouTube video, or a video file or stream from the web, on for everyone. Everyone's app opens the link itself, after seeing it.</p>
          {link}
        </section>
      )}
      <section>
        <div className="party-buttons">
          <PartyCopyLog />
          {host && <PartyEnd />}
        </div>
      </section>
    </div>
  );
}

/** "S1:E3 · Title" as "S1 E3 · Title". */
const episodeLabel = (label?: string) => label?.replace(/\bS(\d+):E(\d+)\b/, "S$1 E$2");

/** The room's position, ticking while it plays. */
function useRoomPosition(party: PartyState) {
  const pb = party.playback;
  const [, tick] = useState(0);
  const running = !!pb && !pb.paused && !pb.held;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return pb ? expectedPosition(pb) : 0;
}

/** What the room is on: poster, title, episode, where, and whether it's playing. */
/** `backdrop`: the poster again, blurred, behind its box (`.party-menu-hero`, positioned) — the menu's header. */
export function PartyNowPlaying({ party, backdrop }: { party: PartyState; backdrop?: boolean }) {
  const media = party.playback?.media;
  const { data: meta } = useMeta(media?.type ?? "movie", media?.metaId ?? "", !!media);
  const position = useRoomPosition(party);
  if (!media || !party.playback) return null;
  const paused = party.playback.paused || party.playback.held;
  const label = episodeLabel(media.label);
  const title = meta?.name ?? label ?? "Something";
  return (
    <div className="party-now">
      {backdrop && meta?.poster && <img className="party-now-backdrop" src={meta.poster} alt="" aria-hidden draggable={false} />}
      <div className="party-now-poster" aria-hidden>
        {meta?.poster && <img src={meta.poster} alt="" draggable={false} />}
      </div>
      <div className="party-now-text">
        <span className="party-kicker">Now playing</span>
        <span className="party-now-title">{title}</span>
        {label && meta?.name && media.type === "series" && <span className="party-now-detail">{label}</span>}
        <span className="party-now-detail tabular">
          {paused ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
          {paused ? "Paused" : "Playing"} · {formatTime(position)}
        </span>
      </div>
    </div>
  );
}

/** Back to the room's video from anywhere, or back in step in the player. */
export function PartyStreamButtons({ party, onGo }: { party: PartyState; onGo?: () => void }) {
  const { current, navigate, replace } = useRouter();
  const media = party.playback?.media;
  if (!media) return null;
  const onRoomVideo = current.name === "player" && current.videoId === media.videoId;
  const go = () => {
    const route = partyRoute(media);
    if (current.name === "player") replace(route);
    else navigate(route);
    onGo?.();
  };
  return (
    <div className="party-buttons party-stream">
      {onRoomVideo ? (
        <Button variant="glass" onClick={syncNow}>
          Sync Now
        </Button>
      ) : (
        <Button variant="primary" onClick={go}>
          <Play size={16} fill="currentColor" /> Go to the Current Stream
        </Button>
      )}
    </div>
  );
}

/** Mute the room's chimes and join/leave notes. */
export function PartyQuiet({ party }: { party: PartyState }) {
  return (
    <label className="party-switch">
      <span className="party-switch-text">
        <span>Mute party sounds</span>
        <span className="party-switch-caption">No chimes or join and leave notices</span>
      </span>
      <Switch checked={party.quiet} onChange={setQuiet} />
    </label>
  );
}

/**
 * Copies this device's party log (#203), to compare a session that went wrong
 * from both ends. Nothing personal in it: see lib/party/log.ts.
 */
export function PartyCopyLog() {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const app = await appVersion().catch(() => "unknown");
    navigator.clipboard.writeText(partyLog([`App ${app} on ${osName}`])).then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );
  };
  return (
    <Button variant="glass" onClick={() => void copy()}>
      <LogIcon size={16} />
      {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't copy" : "Copy Party Log"}
    </Button>
  );
}

/** Ending the party for everyone, asked twice. */
export function PartyEnd() {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirm]);
  return (
    <Button variant="glass" className="party-end" onClick={() => (confirm ? endParty() : setConfirm(true))} aria-live="polite">
      <Power size={16} />
      {confirm ? "End for Everyone?" : "End Party"}
    </Button>
  );
}

/** The host's switches: who can join and who controls playback. */
export function PartyRules({ party }: { party: PartyState }) {
  return (
    <>
      {ruleRows(party.rules).map((r) => (
        <label key={r.label} className="party-switch">
          <span className="party-switch-text">
            <span>
              {r.label === "Lock party" && r.checked && <Lock size={14} />} {r.label}
            </span>
            <span className="party-switch-caption">{r.caption}</span>
          </span>
          <Switch checked={r.checked} onChange={r.set} />
        </label>
      ))}
    </>
  );
}

/** The host's rules as switches, also counted on the menu's Party Settings row. */
function ruleRows(rules: RoomRules): { label: string; caption: string; checked: boolean; set: (on: boolean) => void }[] {
  return [
    {
      label: "Lock party",
      caption: "No new joins: the code stops working until you unlock it",
      checked: rules.locked,
      set: (locked) => setRules({ locked }),
    },
    {
      label: "Approve joins",
      caption: "New people wait until you let them in",
      checked: rules.approve,
      set: (approve) => setRules({ approve }),
    },
    {
      label: "Only I control playback",
      caption: "Play, pause, seeking and changing episodes",
      checked: rules.control === "host",
      set: (on) => setRules({ control: on ? "host" : "everyone" }),
    },
    {
      label: "Wait for everyone",
      caption: "Hold playback while someone is loading",
      checked: rules.wait,
      set: (wait) => setRules({ wait }),
    },
    {
      label: "Pause when someone is buffering",
      caption: "Hold playback while someone's video stalls",
      checked: rules.stall,
      set: (stall) => setRules({ stall }),
    },
  ];
}
