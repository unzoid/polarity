import { useState } from "react";
import { Img } from "../components/Img";
import { EmptyState } from "../components/ui/EmptyState";
import { bioPreview, filmography, lifeFacts } from "../lib/catalog";
import { usePerson } from "../lib/net";
import { initialsOf } from "../screens/Person";
import { TvCard, TvRail } from "./TvRails";

/**
 * A person's page, TV-style: photo, name, the facts and the start of the biography (More reads on), then the
 * titles they act in and directed as rails; Enter on a card opens its page.
 */
export function TvPerson({ id, name }: { id: number; name?: string }) {
  const { data: person, isError } = usePerson(id);
  const [whole, setWhole] = useState(false);
  const shownName = person?.name || name || "";
  const bio = bioPreview(person?.biography, 300);
  const facts = person ? lifeFacts(person) : [];

  return (
    <div className="tv-person tv-scroll" data-nav-scroll="start">
      <header className="tv-person-head" data-nav-row>
        <span className="tv-person-photo">
          {person?.photo ? <Img src={person.photo} alt="" loading="eager" /> : <span aria-hidden>{initialsOf(shownName)}</span>}
        </span>
        <div className="tv-person-text">
          <h1 className="tv-heading">{shownName}</h1>
          {facts.length > 0 && <p className="tv-person-facts">{facts.join(" · ")}</p>}
          {bio.text && <p className="tv-person-bio">{whole ? person?.biography : bio.text}</p>}
          {bio.more && (
            <button className="tv-pill tv-person-more" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
              {whole ? "Less" : "More"}
            </button>
          )}
        </div>
      </header>
      {isError && <EmptyState variant="tv">Couldn't load this page.</EmptyState>}
      {person &&
        filmography(person).map((row) => (
          <TvRail key={row.key} title={row.title}>
            {row.items.map((item) => (
              <TvCard key={item.id} item={item} shape="poster" />
            ))}
          </TvRail>
        ))}
    </div>
  );
}
