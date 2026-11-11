import { createSignal, For, Show } from "solid-js";
import { reveal } from "../lib/reveal";
import { Ref } from "./Footnotes";

// Screenshots follow AGENTS.md: no unblurred posters, key art or title logos.
const scenes: {
  id: string;
  label: string;
  body: string;
  note?: 1 | 2 | 3;
  img: { src: string; w: number; h: number; alt: string };
}[] = [
  {
    id: "profiles",
    label: "Profiles",
    body: "Everyone in the house gets their own avatar, history and settings.",
    img: { src: "/profiles.webp", w: 1426, h: 886, alt: "Polarity's profile picker: who's watching?" },
  },
  {
    id: "anime",
    label: "Anime",
    body: "Rankings, tags, studios, seasons and alternative titles on every show's page.",
    note: 2,
    img: { src: "/anime-details.webp", w: 1424, h: 885, alt: "An anime's page with its rankings, story, tags and facts" },
  },
  {
    id: "party",
    label: "Watch party",
    body: "Friends join with a code. You choose who controls playback and whether everyone waits for each other.",
    img: { src: "/party.webp", w: 1419, h: 883, alt: "A watch party's code, who's watching, and its settings" },
  },
  {
    id: "settings",
    label: "Settings",
    body: "Playback, subtitles, audio, anime, controls and sources, all searchable.",
    img: { src: "/settings.webp", w: 1386, h: 875, alt: "The Anime settings: title language, voice actors and shelves" },
  },
  {
    id: "tv",
    label: "TV mode",
    body: "Large cards, with navigation by controller or arrow keys.",
    img: { src: "/tv-search.webp", w: 2000, h: 1125, alt: "Search in TV mode with an on-screen keyboard and genres" },
  },
];

/** The dark band under the hero: a heading, then one screenshot at a time, picked with a toggle. */
export function Showcase() {
  const [current, setCurrent] = createSignal(0);
  const scene = () => scenes[current()];

  return (
    <section id="showcase" class="band px-gutter pt-16 pb-[72px] md:pt-[88px] md:pb-24">
      <div ref={reveal} class="reveal grid gap-6 md:grid-cols-2 md:items-end md:gap-14">
        <h2 class="text-headline max-w-[11em]">On your desk or your TV.</h2>
        <p class="max-w-[31em] text-[19px]">TV mode has bigger cards and works with a controller or the arrow keys.</p>
      </div>

      <figure class="mt-12 md:mt-16">
        <figcaption class="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
          <div class="seg" role="group" aria-label="Screenshot">
            <For each={scenes}>
              {(s, i) => (
                <button type="button" aria-pressed={i() === current()} onClick={() => setCurrent(i())}>
                  {s.label}
                </button>
              )}
            </For>
          </div>
          <p class="max-w-[36em] text-[17px]">
            {scene().body}
            <Show when={scene().note}>{(n) => <Ref n={n()} />}</Show>
          </p>
        </figcaption>
        {/* The stage takes the current screenshot's shape; the toggle above it never moves. */}
        <div
          ref={reveal}
          class="reveal relative mt-8 overflow-hidden rounded-[14px] bg-black"
          style={{ "aspect-ratio": `${scene().img.w} / ${scene().img.h}` }}
        >
          <For each={scenes}>
            {(s, i) => (
              <img
                src={s.img.src}
                alt={s.img.alt}
                width={s.img.w}
                height={s.img.h}
                loading={i() === 0 ? "eager" : "lazy"}
                aria-hidden={i() !== current()}
                class="absolute inset-0 size-full object-cover object-top transition-opacity duration-500 ease-[var(--ease-out-strong)]"
                classList={{ "opacity-0": i() !== current() }}
              />
            )}
          </For>
        </div>
      </figure>
    </section>
  );
}
