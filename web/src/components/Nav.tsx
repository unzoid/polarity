import { DOWNLOAD_PAGE } from "../lib/release";
import { GitHubMark, REPO_URL } from "./GitHub";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/#open-source", label: "Open source" },
  { href: "/roadmap/", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

/** The wordmark, drawn in the page's ink (#0D0D24) for the lavender background. */
export function Logo(props: { class?: string }) {
  return <img src="/logo-web.svg" alt="Polarity" width={112} height={40} class={`block ${props.class ?? ""}`} />;
}

/** A plain top bar that scrolls away with the page, like the masthead of a poster. */
export function Nav() {
  return (
    <header class="px-gutter flex items-center gap-7 py-[18px]">
      <a href="/" aria-label="Polarity home">
        <Logo />
      </a>
      <nav class="ml-auto hidden items-center gap-7 text-base font-semibold md:flex" aria-label="Main">
        {links.map((l) => (
          <a href={l.href} class="link">
            {l.label}
          </a>
        ))}
      </nav>
      <div class="ml-auto flex items-center gap-2 md:ml-0">
        <a href={REPO_URL} aria-label="Polarity on GitHub" class="grid size-10 place-items-center rounded-full hover:bg-night/10">
          <GitHubMark class="size-5" />
        </a>
        <a href={DOWNLOAD_PAGE} class="btn btn-sm btn-line">
          Download
        </a>
      </div>
    </header>
  );
}
