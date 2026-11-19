import { For } from "solid-js";
import { reveal } from "../lib/reveal";

const questions = [
  {
    q: "Is Polarity free?",
    a: "Yes. Download it from the releases page; after that it keeps itself up to date.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The full source is on GitHub under the MIT license, so you can read it, build it yourself, or contribute.",
  },
  {
    q: "Where do the streams come from?",
    a: "Polarity doesn't host anything. It plays streams from Stremio-compatible addons that you add yourself in Settings.",
  },
  {
    q: "Do I need an account?",
    a: "No, you can use Polarity as a guest. An account lets you sync profiles and history between your devices.",
  },
  {
    q: "Does it work on Mac or Linux?",
    a: "Yes. There's a macOS app for Apple Silicon Macs, and Linux builds as an AppImage, .deb and .rpm. They're on the download page.",
  },
  {
    q: "Is there a phone app?",
    a: "Android and iOS builds are in preview. The Android APK doesn't update itself yet, and the iOS build is unsigned, so you sign it yourself to install it. Both are on the download page.",
  },
];

/** Every answer open at once, two columns wide. */
export function Faq() {
  return (
    <section id="faq" class="mx-auto mt-24 max-w-[1200px] px-6 sm:mt-32 sm:px-8">
      <h2 ref={reveal} class="reveal text-headline">
        FAQ
      </h2>
      {/* Phones: an accordion, so six answers don't fill the screen. Wider: every answer showing. */}
      <div ref={reveal} class="reveal mt-8 border-t border-hair md:hidden">
        <For each={questions}>
          {(item) => (
            <details class="faq-item group border-b border-hair">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.0625rem] font-semibold tracking-[-0.016em] [&::-webkit-details-marker]:hidden">
                {item.q}
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  class="size-4 shrink-0 text-faint transition-transform duration-200 ease-[var(--ease-out-strong)] group-open:rotate-45"
                >
                  <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </summary>
              <p class="pb-5 text-mute">{item.a}</p>
            </details>
          )}
        </For>
      </div>
      <dl ref={reveal} class="reveal mt-12 hidden gap-x-14 gap-y-10 border-t border-hair pt-10 md:grid md:grid-cols-2">
        <For each={questions}>
          {(item) => (
            <div>
              <dt class="text-[1.1875rem] font-semibold tracking-[-0.02em]">{item.q}</dt>
              <dd class="mt-2 max-w-[34rem] text-mute">{item.a}</dd>
            </div>
          )}
        </For>
      </dl>
    </section>
  );
}
