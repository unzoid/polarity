import { useState } from "react";
import type { Anime } from "../../lib/anime";
import { setPrefs, usePrefs } from "../../lib/settings";
import { ChevronDown } from "../icons";
import { Img } from "../Img";
import { Segmented } from "../Segmented";
import { Chip } from "../ui/Chip";
import { EmptyState } from "../ui/EmptyState";

/** Characters with their voice actors (Japanese or English, your pick), folded away until asked for, then the staff. */
export function AnimeCharacters({ anime }: { anime: Anime }) {
  const prefs = usePrefs();
  const lang = prefs.animeVoices;
  const edges = anime.characters.edges;
  const staff = anime.staff.edges;
  const [actorsOpen, setActorsOpen] = useState(false);
  if (!edges.length && !staff.length) return <EmptyState>AniList has no characters for this one yet.</EmptyState>;
  const heading = edges.length > 0 ? "Characters & Voice Actors" : "Staff";
  return (
    <section className="anime-characters-wrap" data-expanded={actorsOpen}>
      <div className="anime-cast-heading">
        <h2 className="t-title2">{heading}</h2>
        <Chip
          type="button"
          variant="badge"
          className="anime-cast-toggle"
          aria-expanded={actorsOpen}
          aria-controls={`anime-cast-${anime.id}`}
          aria-label={`${actorsOpen ? "Hide" : "Show"} ${edges.length > 0 ? "characters and voice actors" : "staff"}`}
          onClick={() => setActorsOpen((open) => !open)}
        >
          {actorsOpen ? "Hide" : "Show"}
          <ChevronDown size={18} />
        </Chip>
      </div>
      <div id={`anime-cast-${anime.id}`} className="anime-cast-content" hidden={!actorsOpen}>
        {edges.length > 0 && (
          <>
            <div className="anime-episodes-bar">
              <span className="t-callout muted">Voices</span>
              <Segmented
                label="Voice language"
                value={lang}
                onChange={(v) => setPrefs({ animeVoices: v })}
                options={[
                  { id: "japanese", label: "Japanese" },
                  { id: "english", label: "English" },
                ]}
              />
            </div>
            <div className="anime-characters">
              {edges.map((e) => {
                const va = (lang === "english" ? e.en : e.ja)[0];
                return (
                  <div key={e.node.id} className="anime-character">
                    <span className="anime-character-side">
                      <Img src={e.node.image?.large ?? undefined} alt="" className="anime-character-img" />
                      <span className="anime-character-text">
                        <span className="t-callout anime-character-name">{e.node.name.full}</span>
                        <span className="t-caption muted">{e.role === "MAIN" ? "Main" : e.role === "SUPPORTING" ? "Supporting" : "Background"}</span>
                      </span>
                    </span>
                    {va && (
                      <span className="anime-character-side anime-character-va">
                        <span className="anime-character-text">
                          <span className="t-callout anime-character-name">{va.name.full}</span>
                          <span className="t-caption muted">{va.name.native ?? (lang === "english" ? "English" : "Japanese")}</span>
                        </span>
                        <Img src={va.image?.large ?? undefined} alt="" className="anime-character-img" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {staff.length > 0 && (
          <>
            {edges.length > 0 && <h3 className="details-label anime-staff-label">Staff</h3>}
            <div className="anime-staff">
              {staff.map((s) => (
                <div key={`${s.node.id}/${s.role}`} className="anime-staff-item">
                  <span className="t-callout">{s.node.name.full}</span>
                  <span className="t-caption muted">{s.role}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
