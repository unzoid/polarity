import { createSignal, onCleanup, onMount } from "solid-js";
import MenuIcon from "lucide-solid/icons/menu";
import XIcon from "lucide-solid/icons/x";
import { DownloadButton } from "./Download";
import { GitHubMark, REPO_URL } from "./GitHub";
import { Smooth } from "./Smooth";

const links = [
  { href: "/#highlights", label: "Highlights" },
  { href: "/#features", label: "Features" },
  { href: "/roadmap/", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

export function Logo(props: { class?: string; width?: number }) {
  const w = props.width ?? 88;
  return (
    <picture class={props.class}>
      <source srcset="/logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img src="/logo.svg" alt="Polarity" width={w} height={Math.round((w * 100) / 260)} />
    </picture>
  );
}

/**
 * Transparent over the top of the page; once you scroll it becomes a floating,
 * frosted bar (Screen Studio's pattern). Only colors change, so nothing shifts.
 */
export function Nav() {
  let header!: HTMLElement;
  const [scrolled, setScrolled] = createSignal(false);
  // Phones: the section links live in a menu that drops down inside the bar.
  const [open, setOpen] = createSignal(false);
  const solid = () => scrolled() || open();

  onMount(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => open() && !header.contains(e.target as Node) && setOpen(false);
    // Widening past the phone breakpoint shows the inline links, so the menu has no reason to stay open.
    const wide = matchMedia("(min-width: 40rem)");
    const onWide = () => wide.matches && setOpen(false);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    wide.addEventListener("change", onWide);
    onCleanup(() => {
      removeEventListener("scroll", onScroll);
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
      wide.removeEventListener("change", onWide);
    });
  });

  return (
    <header ref={header} class="fixed inset-x-0 top-0 z-50 px-3 pt-4 sm:px-4 sm:pt-6">
      <Smooth
        radius={16}
        edge={solid() ? "var(--hair)" : "transparent"}
        class="material mx-auto max-w-[1168px] transition-[background-color,backdrop-filter] duration-300 ease-[var(--ease-out-strong)]"
        style={{
          "background-color": solid() ? "color-mix(in srgb, var(--tile) 82%, transparent)" : "transparent",
          "backdrop-filter": solid() ? "blur(20px) saturate(180%)" : "none",
        }}
      >
        <div class="flex h-13 items-center pr-2.5 pl-4">
          <a href="/" aria-label="Polarity home" class="-ml-1.5">
            <Logo />
          </a>
          <nav class="ml-auto hidden items-center gap-7 text-sm font-medium text-ink/70 sm:flex" aria-label="Main">
            {links.map((l) => (
              <a href={l.href} class="transition-colors duration-150 hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <div class="ml-auto flex items-center gap-3 sm:ml-7">
            <a
              href={REPO_URL}
              aria-label="Polarity on GitHub"
              class="press grid size-8 place-items-center rounded-full text-ink/70 hover:text-ink"
            >
              <GitHubMark class="size-[18px]" />
            </a>
            <DownloadButton size="sm" />
            <button
              type="button"
              aria-label={open() ? "Close menu" : "Open menu"}
              aria-expanded={open()}
              aria-controls="nav-menu"
              onClick={() => setOpen(!open())}
              class="press -mr-0.5 grid size-8 place-items-center rounded-full text-ink/80 hover:text-ink sm:hidden"
            >
              <span class="grid">
                <MenuIcon class="nav-icon size-5" stroke-width={2} data-hidden={open() ? "" : undefined} />
                <XIcon class="nav-icon size-5" stroke-width={2} data-hidden={open() ? undefined : ""} />
              </span>
            </button>
          </div>
        </div>
        {/* Always mounted so it can animate shut; inert while closed keeps its links out of tab order. */}
        <div class="nav-menu sm:hidden" data-open={open() ? "" : undefined} inert={!open()}>
          <nav id="nav-menu" aria-label="Main">
            <div class="flex flex-col px-2 pb-2">
              {links.map((l) => (
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  class="rounded-[10px] px-3 py-3 text-[1.0625rem] font-medium text-ink/80 hover:bg-ink/5 hover:text-ink"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </Smooth>
    </header>
  );
}
