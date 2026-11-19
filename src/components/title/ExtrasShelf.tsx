import { extraKind, extraStills } from "../../lib/catalog/people";
import type { Extra, Meta } from "../../lib/types";
import { Play } from "../icons";
import { openTrailer } from "../Trailer";
import { Card } from "./Card";
import { Shelf } from "./Shelf";

/** Play one of a title's extras in the trailer player. */
export const playExtra = (e: Extra) => openTrailer({ name: e.name, ytId: e.key, ytFirst: true, ytFrom: "TMDB" });

/**
 * A title's other videos (featurettes, behind the scenes, clips, further trailers) as a row of tiles, each
 * playing in the trailer player. Nothing when the title has none.
 */
export function ExtrasShelf({ meta }: { meta: Pick<Meta, "extras"> }) {
  const extras = meta.extras ?? [];
  if (!extras.length) return null;
  return (
    <section className="extras">
      <Shelf title="Extras" shape="landscape" items={extras} card={(e) => <ExtraCard key={e.key} extra={e} />} />
    </section>
  );
}

function ExtraCard({ extra: e }: { extra: Extra }) {
  const kind = extraKind(e.kind);
  const stills = extraStills(e);
  return (
    <Card
      shape="landscape"
      art={stills[0]}
      artFallbacks={stills.slice(1)}
      fallback={
        <span className="extra-tile">
          <span className="extra-tile-name">{e.name}</span>
          <span className="extra-tile-kind">{kind}</span>
        </span>
      }
      title={e.name}
      detail={kind}
      tabular={false}
      hint={`Play ${e.name}`}
      onClick={() => playExtra(e)}
    >
      <div className="card-art-scrim" />
      <span className="extra-play" aria-hidden>
        <Play size={15} fill="currentColor" />
      </span>
    </Card>
  );
}
