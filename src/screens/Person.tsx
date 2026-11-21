import { useMemo, useState } from "react";
import { HeroGlow } from "../components/HeroGlow";
import { Img } from "../components/Img";
import { PosterCard } from "../components/PosterCard";
import { Segmented } from "../components/Segmented";
import { CardSkeleton } from "../components/title/Card";
import { PosterGrid } from "../components/title/PosterGrid";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { bioPreview, filmography, lifeFacts } from "../lib/catalog";
import { errorMessage } from "../lib/errors";
import { usePerson } from "../lib/net";
import type { ContentType } from "../lib/types";

type KindFilter = "all" | ContentType;

/**
 * A person's page (from a title's cast or credits): their photo, name and biography (its start, with More),
 * then the titles they act in, directed, and wrote, as poster grids that open each title's page.
 */
export function Person({ id, name }: { id: number; name?: string }) {
  const { data: person, isError, error } = usePerson(id);
  const [whole, setWhole] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const [kind, setKind] = useState<KindFilter>("all");
  const shownName = person?.name || name || "";
  const bio = bioPreview(person?.biography);
  const facts = person ? lifeFacts(person) : [];
  const loading = !person && !isError;
  const photo = person?.photo && failedPhoto !== person.photo ? person.photo : undefined;
  const allRows = useMemo(() => (person ? filmography(person) : []), [person]);
  const hasBothKinds = useMemo(() => {
    const types = new Set(allRows.flatMap((r) => r.items.map((i) => i.type)));
    return types.has("movie") && types.has("series");
  }, [allRows]);
  const rows = useMemo(
    () =>
      kind === "all"
        ? allRows
        : allRows.map((r) => ({ ...r, items: r.items.filter((i) => i.type === kind) })).filter((r) => r.items.length > 0),
    [allRows, kind],
  );

  return (
    <div className="scroll person-page">
      <HeroGlow src={photo} />
      <header className="screen-header person-head">
        <span className="person-head-photo">
          {loading ? (
            <Skeleton className="person-head-photo-skeleton" />
          ) : photo ? (
            <Img src={photo} alt="" loading="eager" onFail={() => setFailedPhoto(person?.photo)} />
          ) : (
            <span aria-hidden>{initialsOf(shownName)}</span>
          )}
        </span>
        <div className="person-head-text">
          {shownName ? (
            <h1 className="t-title1">{shownName}</h1>
          ) : loading ? (
            <Skeleton shape="line" width="14rem" height="2rem" />
          ) : null}
          {facts.length > 0 && <p className="person-head-facts t-callout">{facts.join(" · ")}</p>}
          {loading && (
            <div className="person-bio person-bio-skeleton" aria-hidden>
              <Skeleton shape="line" width="11rem" />
              <Skeleton shape="line" width="90%" />
              <Skeleton shape="line" width="76%" />
            </div>
          )}
          {bio.text && (
            <div className="person-bio">
              <p className="t-body">{whole ? person?.biography : bio.text}</p>
              {bio.more && (
                <Button variant="plain" size="sm" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
                  {whole ? "Less" : "More"}
                </Button>
              )}
            </div>
          )}
          {hasBothKinds && (
            <div className="person-filter">
              <Segmented
                label="Filter credits"
                value={kind}
                onChange={setKind}
                options={[
                  { id: "all", label: "All" },
                  { id: "movie", label: "Movies" },
                  { id: "series", label: "Series" },
                ]}
              />
            </div>
          )}
        </div>
      </header>
      {loading && (
        <section className="person-titles" aria-hidden>
          <div className="person-titles-heading-skeleton">
            <Skeleton shape="line" width="7.5rem" height="1.35rem" />
          </div>
          <PosterGrid>
            {Array.from({ length: 8 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </PosterGrid>
        </section>
      )}
      {isError && <EmptyState>Couldn't load this page: {errorMessage(error)}</EmptyState>}
      {person && allRows.length === 0 && <EmptyState>No titles to show for {shownName}.</EmptyState>}
      {person &&
        rows.map((row) => (
          <section key={row.key} className="person-titles">
            <h2 className="t-title2">{row.title}</h2>
            <PosterGrid>
              {row.items.map((item) => (
                <PosterCard key={item.id} item={item} />
              ))}
            </PosterGrid>
          </section>
        ))}
    </div>
  );
}

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("");
