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

export function Faq() {
  return (
    <section id="faq" class="px-gutter scroll-mt-0 pt-16 md:pt-[88px]">
      <div class="grid gap-x-14 gap-y-8 md:grid-cols-2">
        <h2 ref={reveal} class="reveal text-headline max-w-[8em]">
          FAQ
        </h2>
        <div ref={reveal} class="reveal rule-t">
          <For each={questions}>
            {(item) => (
              <details class="group rule-b">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[21px] leading-tight font-extrabold tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    class="size-5 shrink-0 transition-transform duration-200 ease-[var(--ease-out-strong)] group-open:rotate-45"
                  >
                    <path d="M8 1.5v13M1.5 8h13" stroke="currentColor" stroke-width="2.5" />
                  </svg>
                </summary>
                <p class="-mt-1 max-w-[32em] pb-6 text-[19px]">{item.a}</p>
              </details>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
