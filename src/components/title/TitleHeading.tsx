import { useEffect, useRef, useState } from "react";
import { LOGO_SPOTS, useNameWait } from "../../lib/ui";
import { TitleLogo, logoReady } from "../TitleLogo";

/** Where the heading sits; names its classes (`hero-logo` / `hero-title` and so on), so each layout keeps its CSS. */
export type HeadingLook = "hero" | "detail" | "tv-stage" | "tv-detail" | "tv-panel";

/**
 * A title's name at the top of a hero or title page (docs/ui-components.md U4): its logo when it has one,
 * else (or when it doesn't load) the name as the heading. The facts line and synopsis under it stay with each layout, built with
 * `joinFacts`/`kindFacts` from lib/format. Inside a `useArtGate` element the logo or name waits for the art (`art-after`).
 * While `pending` (the logo isn't known yet) neither shows, for at most `NAME_WAIT`: the name keeps the heading's
 * place unseen, so nothing jumps from text to logo (#343). Screen readers get the name from the heading in every state.
 */
export function TitleHeading({
  name,
  logo,
  logos,
  backdrop,
  look,
  pending = false,
  onLogoFail,
  onSettled,
}: {
  name: string;
  logo?: string;
  /** The title's other logos to choose from by contrast with `backdrop`, the picture behind the heading (#215). */
  logos?: string[];
  backdrop?: string;
  look: HeadingLook;
  /** The title's logo is still being worked out (its metadata hasn't answered): undefined `logo` doesn't mean "none" yet. */
  pending?: boolean;
  /** The logo won't show (it didn't load, isn't shaped like one or can't be read): the name shows instead. */
  onLogoFail?: () => void;
  /** What shows is in: the chosen logo loaded, or the name (no logo, or none that reads). See `useHeadingReady`. */
  onSettled?: () => void;
}) {
  // The panel's heading is a side heading (h2) and its logo isn't in the first screenful.
  const panel = look === "tv-panel";
  // A logo that doesn't load (a new title the art host has nothing for yet) leaves the name, never nothing (test report 1, item 10).
  const [failed, setFailed] = useState<string>();
  const waiting = useNameWait(pending && !logo, name);
  const Heading = panel ? "h2" : "h1";
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const nameShown = !(logo && failed !== logo) && !waiting;
  useEffect(() => {
    if (nameShown) settled.current?.();
  }, [nameShown, name]);
  if (logo && failed !== logo)
    return (
      // The heading draws no box of its own (`title-heading`): the logo keeps its place in the layout.
      <Heading className="title-heading" aria-label={name}>
        <TitleLogo
          src={logo}
          logos={logos}
          backdrop={backdrop}
          spot={LOGO_SPOTS[look]}
          alt=""
          className={`${look}-logo art-after`}
          loading={panel ? undefined : "eager"}
          onReady={() => settled.current?.()}
          onFail={() => {
            setFailed(logo);
            onLogoFail?.();
          }}
        />
      </Heading>
    );
  // The desktop layouts set the display type style; TV's own classes size theirs. A name after a logo that failed fades in.
  const cls = `${panel || look.startsWith("tv-") ? "" : "t-display "}${look}-title art-after${logo && failed === logo ? " name-in" : ""}`;
  return (
    <Heading className={cls} title={panel ? undefined : name} data-name-wait={waiting ? "" : undefined}>
      {name}
    </Heading>
  );
}

/**
 * Whether a page's {@link TitleHeading} is done (for `useReadyTogether`): pass `onSettled` to the heading. Known at
 * once when the logo was chosen and loaded before (going back to a title), so the page shows on its first render.
 */
export function useHeadingReady({ logo, logos, backdrop, look, pending = false }: { logo?: string; logos?: string[]; backdrop?: string; look: HeadingLook; pending?: boolean }) {
  const key = `${logo ?? ""}|${pending}`;
  const [settledFor, setSettledFor] = useState<string>();
  const now = !pending && (!logo || logoReady(logo, logos, backdrop, LOGO_SPOTS[look]));
  return { ready: now || settledFor === key, onSettled: () => setSettledFor(key) };
}
