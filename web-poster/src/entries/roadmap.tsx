import { render } from "solid-js/web";
import { For, Show } from "solid-js";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Smooth } from "../components/Smooth";
import { reveal } from "../lib/reveal";
import { GROUPS, ITEMS, type Status } from "../data/roadmap";

const ISSUES = "https://github.com/unzoid/polarity/issues";

function Badge(props: { status: Status; children: string }) {
  return (
    <span
      class="inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold tracking-[-0.005em]"
      style={{ background: `var(--${props.status}-bg)`, color: `var(--${props.status}-ink)` }}
    >
      {props.children}
    </span>
  );
}

function Roadmap() {
  return (
    <Layout>
      <section class="px-gutter pt-[4vh]">
        <h1 class="enter text-display" style={{ "--rise": "16px", "--dur": "800ms" }}>
          Roadmap
        </h1>
        <p class="enter text-lede mt-8 max-w-[30em]" style={{ "--rise": "10px", "--delay": "100ms" }}>
          Features in progress and planned.
        </p>
        <div class="enter mt-9" style={{ "--rise": "8px", "--delay": "180ms" }}>
          <a
            href={`${ISSUES}/new`}
            class="btn btn-sm btn-line"
          >
            Suggest a feature
          </a>
        </div>
      </section>

      <For each={GROUPS}>
        {(group) => {
          const items = ITEMS.filter((i) => i.status === group.status);
          return (
            <Show when={items.length}>
              <section class="px-gutter mt-20 sm:mt-[88px]">
                <header ref={reveal} class="reveal">
                  <h2 class="text-headline">{group.title}</h2>
                  <p class="mt-4 text-[19px]">{group.body}</p>
                </header>
                <ul ref={reveal} class="reveal mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <For each={items}>
                    {(item) => {
                      const body = (
                        <Smooth radius={24} class="h-full bg-tile p-7">
                          <Badge status={item.status}>{group.badge}</Badge>
                          <h3 class="mt-4 text-xl font-semibold tracking-[-0.022em]">{item.title}</h3>
                          <p class="mt-4 text-[19px]">{item.body}</p>
                        </Smooth>
                      );
                      return (
                        <li>
                          {item.issue ? (
                            <a href={`${ISSUES}/${item.issue}`} class="block h-full transition-[filter] duration-200 hover:brightness-[0.97]">
                              {body}
                            </a>
                          ) : (
                            body
                          )}
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            </Show>
          );
        }}
      </For>
    </Layout>
  );
}

render(() => <Roadmap />, document.getElementById("root")!);
