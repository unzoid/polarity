import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LookaheadRow } from "../../src/screens/settings/AdvancedPage";
import { getPrefs, setPrefs } from "../../src/lib/settings/prefs";
import { settingDef } from "../../src/lib/settings";
import { click, render } from "./render";

// The player: like `mpv_lookahead`, it says nothing while the setting is off, and once it's on
// it answers what the reader says (nothing yet while it starts).
let reader: "reading" | null = null;
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => (cmd === "mpv_lookahead" && getPrefs().cropMode !== "fit" && getPrefs().autocropLookahead ? reader : null),
};
afterAll(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const READING = "Reading ahead in the video playing now.";

test("Look ahead for bar changes: the caption stays the same text on and off, the status on a line of its own (#345)", async () => {
  setPrefs({ cropMode: "bars", autocropLookahead: false });
  reader = "reading";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = await render(
    <QueryClientProvider client={client}>
      <LookaheadRow hasMpv />
    </QueryClientProvider>,
  );
  const caption = () => container.querySelector(".settings-row-caption")!;
  const status = () => caption().querySelector(".settings-row-status")?.textContent ?? null;
  // The caption's own text, without the status line.
  const ownText = () => [...caption().childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("");
  const base = settingDef("autocropLookahead").caption;

  await wait(20);
  expect(ownText()).toBe(base!);
  expect(status()).toBeNull();

  await click(container.querySelector("[data-setting=autocropLookahead]"));
  await wait(20);
  expect(getPrefs().autocropLookahead).toBe(true);
  expect(ownText()).toBe(base!);
  expect(status()).toBe(READING);
  // A block of its own: the caption above wraps as it does without it.
  expect(readFileSync("src/styles/screens.css", "utf8")).toMatch(/\.settings-row-status \{\s*display: block;/);
  await unmount();
});

test("Look ahead for bar changes: the status follows the setting at once, every time, never an old answer (#345)", async () => {
  setPrefs({ cropMode: "bars", autocropLookahead: true });
  reader = "reading";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = await render(
    <QueryClientProvider client={client}>
      <LookaheadRow hasMpv />
    </QueryClientProvider>,
  );
  const row = () => container.querySelector("[data-setting=autocropLookahead]");
  const status = () => container.querySelector(".settings-row-status")?.textContent ?? null;
  await wait(20);
  expect(status()).toBe(READING);

  for (let i = 0; i < 3; i++) {
    await click(row());
    expect(getPrefs().autocropLookahead).toBe(false);
    expect(status()).toBeNull();
    await wait(20);
    expect(status()).toBeNull();

    await click(row());
    await wait(20);
    expect(status()).toBe(READING);
  }

  // Turned on again while the new reader is still starting: nothing shown, not the old "Reading
  // ahead", until the reader says so; then it shows within a moment.
  await click(row());
  await wait(20);
  reader = null;
  await click(row());
  expect(status()).toBeNull();
  await wait(20);
  expect(status()).toBeNull();
  reader = "reading";
  await wait(600);
  expect(status()).toBe(READING);

  // Nothing playing: no status, with the setting on.
  reader = null;
  await click(row());
  await click(row());
  await wait(20);
  expect(status()).toBeNull();
  await unmount();
});
