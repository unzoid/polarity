import type { JSX } from "solid-js";
import { Nav } from "./Nav";
import { REPO_URL } from "./GitHub";

/**
 * Lavender page, dark closing band. A page can put its own closing content
 * (`end`) at the top of that band, above the footer line. On short pages the
 * band still reaches the bottom of the window.
 */
export function Layout(props: { children: JSX.Element; end?: JSX.Element }) {
  return (
    <div class="flex min-h-dvh flex-col">
      <Nav />
      <main class="flex-1">{props.children}</main>
      <footer class="band px-gutter mt-[88px] pb-14" classList={{ "pt-16 sm:pt-20": !!props.end, "pt-8": !props.end }}>
        {props.end}
        <div
          class="flex flex-wrap justify-between gap-x-8 gap-y-3 text-[15px]"
          classList={{ "border-t-[1.5px] border-lilac pt-[22px]": !!props.end }}
        >
          <p>Polarity plays streams from add-ons you add yourself and hosts no content.</p>
          <nav class="flex gap-[22px] font-semibold" aria-label="Footer">
            <a href="/download/" class="link">Download</a>
            <a href="/roadmap/" class="link">Roadmap</a>
            <a href={REPO_URL} class="link">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
