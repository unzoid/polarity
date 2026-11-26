import "../styles/person.css";
import { useMemo, useState, type KeyboardEvent } from "react";
import { cardMenu } from "../components/CardMenu";
import { Star } from "../components/icons";
import { Img } from "../components/Img";
import { useIntent } from "../components/PosterCard";
import { Card, CardSkeleton } from "../components/title/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import {
  bioPreview,
  creditLines,
  episodeCount,
  filmography,
  knownForLines,
  personFacts,
  professions,
  type CreditLine,
  type Filmography,
} from "../lib/catalog";
import { errorMessage } from "../lib/errors";
import { usePerson } from "../lib/net";
import { useNavigation } from "../lib/router";
import type { ContentType, MetaPreview } from "../lib/types";
import { sizedArt } from "../lib/ui";

type KindFilter = "all" | ContentType;

/**
 * A person's page (from a title's cast or credits), laid out as a title's page is: their portrait, name and what
 * they do; the biography beside a card of facts; the few titles they're known for; then every credit, newest
 * first, with the part they played and the year. Each title opens its own page.
 */
export function Person({ id, name }: { id: number; name?: string }) {
  const { data: person, isError, error } = usePerson(id);
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const shownName = person?.name || name || "";
  const loading = !person && !isError;
  const photo = person?.photo && failedPhoto !== person.photo ? person.photo : undefined;
  const rows = useMemo(() => (person ? filmography(person) : []), [person]);
  const known = useMemo(() => (person ? knownForLines(person) : []), [person]);
  const does = person ? professions(person) : [];
  const facts = person ? personFacts(person) : [];

  return (
    <div className="scroll person-page">
      <div className="pp">
        <header className="pp-head">
          <span className="pp-photo">
            {loading ? (
              <Skeleton className="pp-photo-skeleton" />
            ) : photo ? (
              <Img src={photo} alt="" loading="eager" onFail={() => setFailedPhoto(person?.photo)} />
            ) : (
              <span aria-hidden>{initialsOf(shownName)}</span>
            )}
          </span>
          <div className="pp-who">
            {shownName ? <h1 className="pp-name">{shownName}</h1> : loading && <Skeleton shape="line" width="14rem" height="2.25rem" />}
            {does.length > 0 && <p className="pp-does">{does.join(" · ")}</p>}
          </div>
        </header>

        {loading && (
          <div className="pp-about" aria-hidden>
            <div className="pp-bio-skeleton">
              <Skeleton shape="line" width="94%" />
              <Skeleton shape="line" width="88%" />
              <Skeleton shape="line" width="60%" />
            </div>
          </div>
        )}
        {person && (person.biography || facts.length > 0) && (
          <div className="pp-about">
            <Bio text={person.biography} />
            {facts.length > 0 && (
              <dl className="pp-facts">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {isError && <EmptyState>Couldn't load this page: {errorMessage(error)}</EmptyState>}
        {person && rows.length === 0 && <EmptyState>No titles to show for {shownName}.</EmptyState>}

        {loading && (
          <section className="pp-section" aria-hidden>
            <Skeleton shape="line" width="5rem" height="0.75rem" />
            <div className="pp-known">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          </section>
        )}
        {known.length > 2 && rows[0].items.length > known.length && (
          <section className="pp-section" aria-labelledby="pp-known">
            <h2 className="pp-kicker" id="pp-known">
              Known for
            </h2>
            <div className="pp-known">
              {known.map((line) => (
                <KnownCard key={line.item.id} line={line} />
              ))}
            </div>
          </section>
        )}
        {person && rows.length > 0 && <Credits person={person} rows={rows} />}
      </div>
    </div>
  );
}

/** The biography: its start, then the whole of it on More. */
function Bio({ text }: { text?: string }) {
  const [whole, setWhole] = useState(false);
  const bio = bioPreview(text);
  if (!bio.text) return <div />;
  return (
    <div className="pp-bio">
      <p>{whole ? text : bio.text}</p>
      {bio.more && (
        <button type="button" className="pp-more" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
          {whole ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** Every credit in one list at a time (Acting, Directing, Writing), films and shows or one of them. */
function Credits({ person, rows }: { person: Parameters<typeof creditLines>[0]; rows: Filmography[] }) {
  const [list, setList] = useState(rows[0].key);
  const [kind, setKind] = useState<KindFilter>("all");
  const row = rows.find((r) => r.key === list) ?? rows[0];
  const lines = useMemo(() => creditLines(person, row), [person, row]);
  const both = lines.some((l) => l.item.type === "movie") && lines.some((l) => l.item.type === "series");
  const shown = both && kind !== "all" ? lines.filter((l) => l.item.type === kind) : lines;

  return (
    <section className="pp-section" aria-labelledby="pp-credits">
      <h2 className="pp-kicker" id="pp-credits">
        Credits
      </h2>
      <div className="pp-chips-bar">
        {rows.length > 1 && (
          <Chips
            label="Credits"
            value={row.key}
            onChange={(k) => {
              setList(k);
              setKind("all");
            }}
            options={rows.map((r) => ({ id: r.key, label: r.title, count: r.items.length }))}
          />
        )}
        {both && (
          <Chips
            label="Show"
            value={kind}
            onChange={setKind}
            options={[
              { id: "all", label: "All" },
              { id: "movie", label: "Movies" },
              { id: "series", label: "Series" },
            ]}
          />
        )}
      </div>
      <ol className="pp-lines">
        {shown.map((line) => (
          <li key={line.item.id}>
            <CreditRow line={line} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Pills to pick one of, as Sources' quality filter: the one picked white, arrow keys move along. */
function Chips<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[] }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + step + options.length) % options.length];
    onChange(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
  };
  return (
    <div className="pp-chips" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          data-id={o.id}
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          className="pp-chip"
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count != null && <span className="pp-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The part in a title: "Nora · 12 episodes", the job, or nothing when TMDB doesn't say. */
const partOf = (line: CreditLine) => [line.role, line.episodes != null && episodeCount(line.episodes)].filter(Boolean).join(" · ");

function useOpen(item: MetaPreview) {
  const { navigate } = useNavigation();
  return () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
}

/** A title they're known for: its poster, with their part under the name. */
function KnownCard({ line }: { line: CreditLine }) {
  const { item } = line;
  const open = useOpen(item);
  const intent = useIntent(item);
  return (
    <Card
      shape="poster"
      art={item.poster}
      artFallbacks={item.background ? [item.background] : undefined}
      fallback={<span className="card-fallback t-headline">{item.name}</span>}
      title={item.name}
      detail={[line.role, line.year].filter(Boolean).join(" · ")}
      tabular={false}
      keepCaption
      onClick={open}
      {...intent}
      {...cardMenu(item)}
    />
  );
}

/** One credit: the year, a small poster, the title with the part under it, and its score. */
function CreditRow({ line }: { line: CreditLine }) {
  const { item } = line;
  const open = useOpen(item);
  const intent = useIntent(item);
  const [noArt, setNoArt] = useState(false);
  const part = partOf(line);
  const score = Number(item.imdbRating);
  return (
    <button type="button" className="pp-line" onClick={open} {...intent} {...cardMenu(item)}>
      <span className="pp-line-year">{line.year ?? "—"}</span>
      <span className="pp-line-art">
        {item.poster && !noArt && <Img src={sizedArt(item.poster, "w185")} alt="" loading="lazy" onFail={() => setNoArt(true)} />}
      </span>
      <span className="pp-line-text">
        <span className="pp-line-name">{item.name}</span>
        <span className="pp-line-part">
          {item.type === "series" ? "Series" : "Movie"}
          {part && ` · ${part}`}
          {line.year && <span className="pp-line-part-year"> · {line.year}</span>}
        </span>
      </span>
      {score > 0 && (
        <span className="pp-line-score" aria-label={`Rated ${score.toFixed(1)} out of 10`}>
          <Star size={12} />
          {score.toFixed(1)}
        </span>
      )}
    </button>
  );
}

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("");
