import { useRef } from "react";
import { Img } from "../components/Img";
import { playExtra } from "../components/title/ExtrasShelf";
import { extraKind, extraStill } from "../lib/catalog";
import type { Meta } from "../lib/types";
import { useFocusTrap } from "./shell";
import { TvRail } from "./TvRails";

/**
 * A title's extras, full screen: one rail of tiles, each playing in the trailer player over the panel (Back
 * closes the player, then the panel). A tile whose still doesn't load shows its name and kind.
 */
export function TvExtrasPanel({ meta }: { meta: Meta }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div className="tv-panel tv-sources tv-extras" ref={ref} data-nav-scope role="dialog" aria-label="Extras">
      <header className="tv-sources-head">
        <h2 className="tv-heading">{meta.name}</h2>
        <p className="tv-sources-sub">Extras</p>
      </header>
      <TvRail>
        {(meta.extras ?? []).map((e, i) => (
          <button key={e.key} className="tv-card tv-extra" data-shape="landscape" data-nav-default={i === 0 || undefined} onClick={() => playExtra(e)}>
            <span className="tv-card-frame">
              <span className="tv-card-fallback tv-extra-fallback">
                <span>{e.name}</span>
                <span className="tv-extra-kind">{extraKind(e.kind)}</span>
              </span>
              <Img src={extraStill(e)} alt="" className="tv-card-img" />
            </span>
            <span className="tv-extra-caption">
              <span className="tv-extra-name">{e.name}</span>
              <span className="tv-extra-kind">{extraKind(e.kind)}</span>
            </span>
          </button>
        ))}
      </TvRail>
    </div>
  );
}
