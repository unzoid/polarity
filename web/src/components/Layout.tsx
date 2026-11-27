import { For, type JSX } from "solid-js";
import { Logo, Nav } from "./Nav";
import { REPO_URL } from "./GitHub";
import { Flutes } from "./Flutes";
import { Smooth } from "./Smooth";

const links = [
  { href: "/download/", label: "Download" },
  { href: "/roadmap/", label: "Roadmap" },
  { href: REPO_URL, label: "GitHub" },
  { href: `${REPO_URL}/issues`, label: "Issues" },
  { href: `${REPO_URL}/blob/master/LICENSE`, label: "License" },
];

export function Layout(props: { children: JSX.Element }) {
  return (
    <>
      <Nav />
      <main>{props.children}</main>
      <footer class="mx-auto mt-16 max-w-[1600px] px-2 pb-2 text-sm sm:mt-20 sm:px-3 sm:pb-3">
        {/* The logo's star rises from below the edge, mirroring the hero's. */}
        <Smooth radius={28}>
          <Flutes shape="star" count={3} origin={[0.5, 1.55]} drift={0.04} class="absolute inset-0" />
          <div class="relative mx-auto flex max-w-[1200px] flex-col gap-8 px-6 pt-14 pb-16 sm:flex-row sm:items-end sm:px-8 sm:pt-20 sm:pb-24">
            <div>
              <Logo width={88} class="-ml-1.5 block" />
              <p class="mt-3 max-w-[22rem] text-mute">
                Polarity plays streams from add-ons you add yourself and hosts no content.
              </p>
            </div>
            <nav class="flex flex-wrap gap-x-6 gap-y-2 sm:ml-auto" aria-label="Footer">
              <For each={links}>
                {(l) => (
                  <a href={l.href} class="text-mute transition-colors duration-150 hover:text-ink">
                    {l.label}
                  </a>
                )}
              </For>
            </nav>
          </div>
        </Smooth>
      </footer>
    </>
  );
}
