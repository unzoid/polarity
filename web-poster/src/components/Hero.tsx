import { For, onMount } from "solid-js";
import { DownloadButton, ReleaseNote } from "./Download";

/** Each word's resting weight and opacity: the sentence thins out as it goes. */
const words: { t: string; w: number; a: number }[] = [
  { t: "Your", w: 900, a: 1 },
  { t: "shows,", w: 900, a: 1 },
  { t: "movies", w: 820, a: 0.95 },
  { t: "and", w: 700, a: 0.88 },
  { t: "anime,", w: 560, a: 0.8 },
  { t: "all", w: 420, a: 0.72 },
  { t: "in", w: 330, a: 0.64 },
  { t: "one", w: 260, a: 0.58 },
  { t: "place.", w: 220, a: 0.52 },
];

export function Hero() {
  let h1!: HTMLHeadingElement;

  // Start thin and faint, then let the words settle one after another.
  onMount(() => {
    h1.setAttribute("data-inking", "");
    requestAnimationFrame(() => requestAnimationFrame(() => h1.removeAttribute("data-inking")));
  });

  return (
    <section class="px-gutter pt-[4vh] pb-16">
      <h1 ref={h1} class="text-display">
        <For each={words}>
          {(word, i) => (
            <>
              <span class="ink-word" data-word={word.t}>
                <span class="ink" style={{ "--i": i(), "--w": word.w, "--a": word.a }}>
                  {word.t}
                </span>
              </span>{" "}
            </>
          )}
        </For>
      </h1>

      <div class="enter mt-10 grid gap-7 md:mt-12 md:grid-cols-2 md:items-end md:gap-14" style={{ "--delay": "600ms" }}>
        <p class="text-lede max-w-[30em]">
          A free, open-source desktop player and library, with a TV mode.
        </p>
        <div class="flex flex-wrap items-center gap-x-[18px] gap-y-3">
          <DownloadButton />
          <ReleaseNote />
        </div>
      </div>
    </section>
  );
}
