import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { reveal } from "../lib/reveal";
import { Ref } from "./Footnotes";
import { Flutes } from "./Flutes";
import { Smooth } from "./Smooth";

// Screenshots follow AGENTS.md: no unblurred posters, key art or title logos.
const scenes: {
  id: string;
  title: string;
  body: string;
  note?: 1 | 2 | 3;
  img: { src: string; w: number; h: number; alt: string };
}[] = [
  {
    id: "anime",
    title: "Anime",
    body: "Rankings, tags, studios, seasons and alternative titles on every show's page.",
    note: 2,
    img: { src: "/anime-details.webp", w: 1424, h: 885, alt: "An anime's page with its rankings, story, tags and facts" },
  },
  {
    id: "party",
    title: "Watch party",
    body: "Friends join with a code. You choose who controls playback and whether everyone waits for each other.",
    img: { src: "/party.webp", w: 1419, h: 883, alt: "A watch party's code, who's watching, and its settings" },
  },
  {
    id: "settings",
    title: "Settings",
    body: "Playback, subtitles, audio, anime, controls and sources, all searchable.",
    img: { src: "/settings.webp", w: 1386, h: 875, alt: "The Anime settings: title language, voice actors and shelves" },
  },
  {
    id: "tv",
    title: "TV mode",
    body: "Large cards, with navigation by controller or arrow keys.",
    img: { src: "/tv-search.webp", w: 2000, h: 1125, alt: "Search in TV mode with an on-screen keyboard and genres" },
  },
];

/**
 * Helium-style highlight pager: the copy on the left, the screenshot on fluted glass on the right.
 * The active dot fills and then advances; hovering, focusing or scrolling away pauses it, and with
 * reduced motion it only moves when a dot is pressed.
 */
export function Showcase() {
  let section!: HTMLElement;
  const [active, setActive] = createSignal(0);
  const [hovered, setHovered] = createSignal(false);
  const [inView, setInView] = createSignal(false);

  onMount(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.4 });
    io.observe(section);
    onCleanup(() => io.disconnect());
  });

  const next = () => setActive((i) => (i + 1) % scenes.length);

  return (
    <section
      ref={section}
      id="highlights"
      class="mx-auto mt-24 max-w-[1200px] px-2 sm:mt-32 sm:px-8"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusIn={() => setHovered(true)}
      onFocusOut={() => setHovered(false)}
    >
      <div ref={reveal} class="reveal grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14">
        {/* On phones the media runs to the hero's 8px margin; the copy keeps the page's 24px. */}
        <div class="px-4 sm:px-0">
          {/* Panels share one grid cell and crossfade, so the column keeps the tallest one's height. */}
          <div class="grid" aria-live="polite">
            <For each={scenes}>
              {(scene, i) => (
                <div
                  id={`${scene.id}-panel`}
                  class="[grid-area:1/1] transition-[opacity,translate] duration-500 ease-[var(--ease-out-strong)]"
                  classList={{ "opacity-0 translate-y-2": active() !== i() }}
                  inert={active() !== i()}
                >
                  <h2 class="text-headline text-balance">
                    {scene.title}
                    <Show when={scene.note}>{(n) => <Ref n={n()} />}</Show>
                  </h2>
                  <p class="text-lede mt-5 max-w-[26rem] text-mute">{scene.body}</p>
                </div>
              )}
            </For>
          </div>

          <div
            class="mt-10 flex items-center gap-2"
            classList={{ "pager-paused": hovered() || !inView() }}
            role="group"
            aria-label="Highlights"
          >
            <For each={scenes}>
              {(scene, i) => (
                <button
                  type="button"
                  aria-label={scene.title}
                  aria-controls={`${scene.id}-panel`}
                  aria-current={active() === i() ? "true" : undefined}
                  onClick={() => setActive(i())}
                  class="group grid h-8 place-items-center px-1 focus-visible:outline-none"
                >
                  <span
                    class="relative block h-2.5 overflow-hidden rounded-full bg-ink/15 transition-[width,background-color] duration-500 ease-[var(--ease-out-strong)] group-hover:bg-ink/25 group-focus-visible:outline-2 group-focus-visible:outline-offset-3 group-focus-visible:outline-accent"
                    style={{ width: active() === i() ? "3.25rem" : "0.625rem" }}
                  >
                    <Show when={active() === i()}>
                      <span class="pager-fill absolute inset-0 rounded-full bg-accent" onAnimationEnd={next} />
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="drop-shadow-[0_24px_48px_var(--shadow)]">
          <Smooth radius={24} edge="var(--edge)" class="aspect-[16/11]">
            <Flutes shape="flutes" count={9} origin={[0.7, 0.35]} class="absolute inset-0" />
            <For each={scenes}>
              {(scene, i) => (
                <div
                  class="absolute inset-0 flex items-center justify-center p-[6%] transition-[opacity,scale] duration-700 ease-[var(--ease-out-strong)]"
                  classList={{ "opacity-0 scale-[0.98]": active() !== i() }}
                >
                  <img
                    src={scene.img.src}
                    alt={active() === i() ? scene.img.alt : ""}
                    width={scene.img.w}
                    height={scene.img.h}
                    loading="lazy"
                    class="h-auto max-h-full min-h-0 w-auto max-w-full min-w-0 rounded-[14px] bg-black shadow-[0_20px_40px_rgb(0_0_0/0.35),0_0_0_1px_var(--edge)]"
                  />
                </div>
              )}
            </For>
          </Smooth>
        </div>
      </div>
    </section>
  );
}
