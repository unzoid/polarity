import { reveal } from "../lib/reveal";
import { GitHubButton, REPO_URL } from "./GitHub";

export function OpenSource() {
  return (
    <section id="open-source" class="px-gutter scroll-mt-0 pt-16 md:pt-[88px]">
      <div ref={reveal} class="reveal grid gap-x-14 gap-y-6 md:grid-cols-2 md:items-end">
        <h2 class="text-headline max-w-[11em]">Open source</h2>
        <div class="max-w-[30em] text-[19px]">
          <p>The code is on GitHub under the MIT license. Read it, build it yourself, report bugs or suggest features.</p>
          <div class="mt-[22px] flex flex-wrap items-center gap-x-[18px] gap-y-3">
            <GitHubButton />
            <a href={`${REPO_URL}/issues`} class="link text-base font-semibold">
              Issues and requests
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
