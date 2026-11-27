import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { PlaylistTray } from "../../src/components/library/PlaylistTray";
import { forgetPlaylists, setPlaylistSpace } from "../../src/lib/library/playlists";
import { keys } from "../../src/lib/net/queryKeys";
import type { MetaPreview } from "../../src/lib/types";
import { byText, click, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const SPACE = "test-playlist-tray";
setPlaylistSpace(SPACE);
afterAll(() => forgetPlaylists(SPACE));

const film: MetaPreview = { id: "tt0000001", type: "movie", name: "A Made-Up Film" };

const title = () => document.querySelector("[role=dialog]")?.getAttribute("aria-label");
const rows = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] [role=checkbox]")].map((r) => [
    r.querySelector(".ft-picker-label")?.textContent,
    r.getAttribute("aria-checked"),
  ]);

test("Add to List tray: My List first, then a new playlist made from it, ticked and unticked", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(keys.library, [{ ...film, addedAt: 1 }]);
  const { unmount } = await render(
    <QueryClientProvider client={client}>
      <PlaylistTray item={film} open onClose={() => {}} />
    </QueryClientProvider>,
  );
  await settle();
  expect(title()).toBe("Add to List");
  expect(rows()).toEqual([["My List", "true"]]);

  await click(byText(document.body, "[role=dialog] .ft-picker-new", "New Playlist"));
  await settle();
  expect(title()).toBe("New Playlist");
  const field = document.querySelector<HTMLInputElement>("[role=dialog] input[aria-label='Playlist name']")!;
  expect(field.placeholder).toBe("New Playlist");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Weekend");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(byText(document.body, "[role=dialog] .ft-pill", "Create Playlist"));
  await settle();

  expect(title()).toBe("Add to List");
  expect(rows()).toEqual([
    ["My List", "true"],
    ["Weekend", "true"],
  ]);
  const weekend = () => document.querySelectorAll<HTMLButtonElement>("[role=dialog] [role=checkbox]")[1];
  await click(weekend());
  expect(weekend().getAttribute("aria-checked")).toBe("false");
  expect(weekend().querySelector(".ft-picker-meta")?.textContent).toBe("0");

  // Back from the name step returns to the list without making anything.
  await click(byText(document.body, "[role=dialog] .ft-picker-new", "New Playlist"));
  await settle();
  await click(document.querySelector("[role=dialog] [aria-label=Back]"));
  await settle();
  expect(title()).toBe("Add to List");
  expect(rows()).toHaveLength(2);

  await unmount();
});
