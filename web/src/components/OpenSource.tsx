import { createResource, For, Show } from "solid-js";
import CircleCheck from "lucide-solid/icons/circle-check";
import type { ClosedIssue } from "../../server/app";
import { reveal } from "../lib/reveal";
import { GitHubButton, REPO_URL } from "./GitHub";
import { Flutes } from "./Flutes";
import { Smooth } from "./Smooth";

async function fetchIssues(): Promise<ClosedIssue[]> {
  try {
    const res = await fetch("/api/issues");
    return res.ok ? ((await res.json()) as ClosedIssue[]) : [];
  } catch {
    return [];
  }
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

/** "2h ago", "yesterday", "3d ago". */
function ago(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes > -60) return relative.format(Math.min(minutes, -1), "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

/**
 * Copy on the left; on the right, the latest fixed issues on a glass card over rays.
 * Until they load (or if GitHub is unavailable) the rays show the logo's star instead.
 */
export function OpenSource() {
  const [issues] = createResource(fetchIssues);

  return (
    <section id="open-source" class="mx-auto mt-24 max-w-[1200px] px-2 sm:mt-32 sm:px-8">
      <div ref={reveal} class="reveal">
        <Smooth radius={28} edge="var(--hair)" class="grid bg-tile lg:grid-cols-2">
          <div class="flex flex-col justify-center px-6 pt-10 pb-8 sm:p-12 lg:p-14">
            <h2 class="text-headline">Open source</h2>
            <p class="text-lede mt-5 max-w-[30rem] text-mute">
              Polarity's code is on GitHub under the MIT license. Read it, build it yourself, report bugs or suggest
              features.
            </p>
            <div class="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-9">
              <GitHubButton />
              <a
                href={`${REPO_URL}/issues`}
                class="press inline-flex h-12 items-center rounded-full px-5 text-[1.0625rem] font-medium text-icon hover:underline"
              >
                Issues and requests
              </a>
            </div>
          </div>

          <div class="p-2">
            <Smooth radius={22} class="flex h-full min-h-[220px] items-center sm:min-h-[320px]">
              <Flutes shape="rays" count={28} origin={[0.5, 0.5]} drift={0.15} class="absolute inset-0" />
              <Show
                when={issues()?.length}
                fallback={
                  <svg
                    viewBox="0 0 44 44"
                    aria-hidden="true"
                    class="absolute top-1/2 left-1/2 size-14 -translate-1/2 text-icon drop-shadow-[0_0_24px_var(--flute-glow)] sm:size-16"
                  >
                    <path d="M22 0l6 16 16 6-16 6-6 16-6-16L0 22l16-6z" fill="currentColor" />
                  </svg>
                }
              >
                <div class="relative w-full p-3 sm:p-8 lg:p-10">
                  <Smooth
                    radius={16}
                    edge="var(--hair)"
                    class="w-full backdrop-blur-xl backdrop-saturate-150"
                    style={{ "background-color": "color-mix(in srgb, var(--tile) 78%, transparent)" }}
                  >
                    <h3 class="px-4 pt-3.5 pb-1 text-xs font-medium text-faint">Recently fixed</h3>
                    <ol class="pb-1.5">
                      <For each={issues()}>
                        {(issue) => (
                          <li>
                            <a
                              href={issue.url}
                              class="flex gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-ink/5"
                            >
                              <CircleCheck class="mt-0.5 size-4 shrink-0 text-icon" stroke-width={2} aria-hidden="true" />
                              <span class="min-w-0 flex-1">
                                <span class="block truncate text-[0.9375rem] font-medium">{issue.title}</span>
                                <span class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                                  <span class="tabular-nums">#{issue.number}</span>
                                  <For each={issue.labels.slice(0, 3)}>
                                    {(label) => <span class="rounded-full bg-ink/8 px-1.5 py-px text-mute">{label}</span>}
                                  </For>
                                  <span>· closed {ago(issue.closedAt)}</span>
                                </span>
                              </span>
                            </a>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Smooth>
                </div>
              </Show>
            </Smooth>
          </div>
        </Smooth>
      </div>
    </section>
  );
}
