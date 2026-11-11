import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsOverlay } from "../../src/components/SettingsOverlay";
import { AccountContext, type Account } from "../../src/lib/account";
import { keys } from "../../src/lib/net";
import { closeSettings, openSettings } from "../../src/lib/settings/overlay";
import { byText, click, press, render } from "./render";

// #341: a search result's row is highlighted once, when it is opened from the search, never again for that search.

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(keys.settings, {});
afterAll(() => client.clear());

const signedOut = { status: "signed-out", profile: null, profiles: [], enabled: false } as unknown as Account;
const hits = () => document.querySelectorAll("[data-search-hit]").length;
const nav = (label: string) => byText(document, ".t3s-nav-item", label);

async function search(text: string) {
  const field = document.querySelector<HTMLInputElement>(".t3s-search input")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Enter", field);
  await wait(40); // the reveal waits a frame for the page
}

test("Settings search: an interrupted highlight doesn't come back with the page or the next opening", async () => {
  const { unmount } = await render(
    <QueryClientProvider client={client}>
      <AccountContext.Provider value={signedOut}>
        <SettingsOverlay />
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  await act(async () => openSettings("playback"));
  await wait(20);

  await search("Pause when minimized");
  expect(hits()).toBe(1);
  const row = document.querySelector("[data-search-hit]")!;
  // The browser cancels the highlight when its row goes out of sight; the mark goes with it.
  await act(async () => void row.dispatchEvent(new Event("animationcancel")));
  expect(row.hasAttribute("data-search-hit")).toBe(false);

  await search("Pause when minimized");
  expect(hits()).toBe(1);
  // Left before the highlight ends, then back: no highlight.
  await click(nav("Subtitles & Audio"));
  await wait(40);
  await click(nav("Playback"));
  await wait(40);
  expect(hits()).toBe(0);

  // Closed before it ends and opened again: no highlight, even with no animation event at all.
  await search("Pause when minimized");
  expect(hits()).toBe(1);
  await act(async () => closeSettings());
  await wait(20);
  await act(async () => openSettings());
  await wait(40);
  expect(hits()).toBe(0);

  // A mark whose animation never reports back is gone once the highlight's length has passed.
  await search("Pause when minimized");
  expect(hits()).toBe(1);
  await wait(1500);
  expect(hits()).toBe(0);

  await act(async () => closeSettings());
  await unmount();
});
