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

/** Everything at a glance. */
const overview: { icon: Component<LucideProps>; title: string; body: string; note?: 1 | 2 | 3 }[] = [
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

export function Features() {
  return (
    <section id="features" class="px-gutter scroll-mt-0 pt-16 md:pt-[88px]">
      <div>
        <h2 ref={reveal} class="reveal text-headline">Features</h2>
        {/* One big ink card, like the app's own feature panel. */}
        <ul
          ref={reveal}
          class="reveal band mt-10 grid gap-x-12 gap-y-12 rounded-[28px] px-8 py-12 sm:grid-cols-2 sm:px-12 sm:py-14 md:mt-12 lg:grid-cols-3 lg:gap-y-16"
        >
          <For each={overview}>
            {(f) => (
              <li>
                <f.icon class="size-7" stroke-width={2} aria-hidden="true" />
                <h3 class="mt-4 text-[21px] leading-tight font-extrabold tracking-[-0.02em] text-white">
                  {f.title}
                  <Show when={f.note}>{(n) => <Ref n={n()} />}</Show>
                </h3>
                <p class="mt-1.5 max-w-[20em] text-[17px] leading-snug">{f.body}</p>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
