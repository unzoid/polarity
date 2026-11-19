import { For, Show, type Component } from "solid-js";
import type { LucideProps } from "lucide-solid";
import FastForward from "lucide-solid/icons/fast-forward";
import History from "lucide-solid/icons/rotate-ccw-clock";
import Users from "lucide-solid/icons/users";
import Sparkles from "lucide-solid/icons/sparkles";
import CalendarDays from "lucide-solid/icons/calendar-days";
import Download from "lucide-solid/icons/download";
import Bookmark from "lucide-solid/icons/bookmark";
import CircleUser from "lucide-solid/icons/circle-user";
import Captions from "lucide-solid/icons/captions";
import { reveal } from "../lib/reveal";
import { Ref } from "./Footnotes";
import { Smooth } from "./Smooth";

type Feature = { icon: Component<LucideProps>; title: string; body: string; note?: 1 | 2 | 3 };

const features: Feature[] = [
  { icon: FastForward, title: "Skip intros", body: "Jump past intros and recaps, and skip filler episodes in anime.", note: 1 },
  { icon: History, title: "Resume anywhere", body: "Pick up exactly where you stopped, on any of your devices." },
  { icon: Users, title: "Watch parties", body: "Watch together with playback kept in sync." },
  { icon: Sparkles, title: "Anime", body: "Its own section, search and episode lists.", note: 2 },
  { icon: CalendarDays, title: "Calendar", body: "Upcoming episodes from your library and the shows you're watching.", note: 3 },
  { icon: Download, title: "Downloads", body: "Save a title and watch it later, offline." },
  { icon: Bookmark, title: "Your library", body: "A watchlist, your history, and playlists of your own." },
  { icon: CircleUser, title: "Profiles", body: "Everyone gets their own avatar, history and settings." },
  { icon: Captions, title: "Subtitles and sound", body: "Settings that apply straight away, even mid-video." },
];

/** A left-aligned heading, then one tile per feature. */
export function Features() {
  return (
    <section id="features" class="mx-auto mt-24 max-w-[1200px] px-2 sm:mt-32 sm:px-8">
      <h2 ref={reveal} class="reveal text-headline px-4 sm:px-0">
        Features
      </h2>
      {/* One card holding every feature, as on the current site. */}
      <div ref={reveal} class="reveal mt-10 sm:mt-12">
        {/* On phones each icon sits beside its text, so the list stays short; wider, it sits on top. */}
        <Smooth radius={28} edge="var(--hair)" class="bg-tile px-6 py-8 sm:px-12 sm:py-14">
          <ul class="grid gap-x-12 gap-y-7 sm:grid-cols-2 sm:gap-y-14 lg:grid-cols-3">
            <For each={features}>
              {(f) => (
                <li class="flex gap-4 sm:block">
                  <f.icon class="mt-0.5 size-6 shrink-0 text-icon" stroke-width={1.75} aria-hidden="true" />
                  <div>
                    <h3 class="text-[1.0625rem] font-semibold tracking-[-0.016em] sm:mt-5">
                      {f.title}
                      <Show when={f.note}>{(n) => <Ref n={n()} />}</Show>
                    </h3>
                    <p class="mt-1 max-w-[19rem] text-[0.9375rem] leading-[1.45] text-mute sm:mt-1.5">{f.body}</p>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Smooth>
      </div>
    </section>
  );
}
