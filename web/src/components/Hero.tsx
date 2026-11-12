import type { JSX } from "solid-js";
import { DownloadButton, ReleaseNote } from "./Download";
import { GitHubButton } from "./GitHub";
import { Flutes } from "./Flutes";
import { Smooth } from "./Smooth";

/** Inline vars for the `.enter` keyframe: delay, duration, rise distance, blur, start scale. */
const beat = (delay: number, dur: number, rise: number, extra: JSX.CSSProperties = {}): JSX.CSSProperties => ({
  "--delay": `${delay}ms`,
  "--dur": `${dur}ms`,
  "--rise": `${rise}px`,
  ...extra,
});

/**
 * One large glass card under the (transparent) navbar: star-shaped flutes radiate from the top right,
 * the copy sits left, and the app rises out of the card's bottom edge.
 */
export function Hero() {
  return (
    <section class="px-2 pt-2 sm:px-3 sm:pt-3">
      <Smooth radius={28} class="mx-auto max-w-[1600px]">
        <Flutes shape="star" count={6} origin={[0.86, 0.14]} drift={0.05} class="absolute inset-0" />
        <div class="relative mx-auto max-w-[1200px] px-6 pt-32 sm:px-8 sm:pt-40">
          <h1 class="enter text-display" style={beat(0, 900, 18, { "--blur": "6px" })}>
            Polarity
          </h1>
          <p class="enter text-lede mt-5 max-w-[30rem] text-balance text-mute" style={beat(120, 800, 12)}>
            A desktop player and library for your shows, movies and anime.
          </p>
          <div class="enter mt-9 flex flex-col items-start gap-4" style={beat(240, 800, 8)}>
            <div class="flex flex-wrap gap-3">
              <DownloadButton />
              <GitHubButton />
            </div>
            <ReleaseNote />
          </div>

          <div
            class="enter relative mt-16 -mb-[14%] sm:mt-20"
            style={beat(360, 1100, 40, { "--from-scale": "0.98" })}
          >
            <div class="drop-shadow-[0_30px_60px_var(--shadow)]">
              <Smooth radius={18} edge="var(--edge)">
                <img
                  src="/profiles.webp"
                  alt="Polarity's profile picker: who's watching?"
                  width="1426"
                  height="886"
                  class="block w-full"
                  fetchpriority="high"
                />
              </Smooth>
            </div>
          </div>
        </div>
      </Smooth>
    </section>
  );
}
