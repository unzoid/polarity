import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { FilteredCollection } from "../../src/components/library/CollectionFilters";
import type { LibraryEntry } from "../../src/lib/library/libraryView";
import { byText, click, render } from "./render";

// Library → Saved in full: the search narrows the grid, says how many are left, and an empty result names
// what hides everything with a way to clear it. Made-up titles.

const entries: LibraryEntry<string>[] = [
  { item: "tt0000001", id: "tt0000001", type: "movie", name: "Harbour Lights", addedAt: 2, facts: { year: 1994, genres: ["Drama"] } },
  { item: "tt0000002", id: "tt0000002", type: "series", name: "The Long Orbit", addedAt: 1, facts: { year: 2019, genres: ["Sci-Fi"] } },
];

afterEach(() => localStorage.clear());

async function type(text: string) {
  const field = document.querySelector<HTMLInputElement>(".library-filters input")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const shown = () => [...document.querySelectorAll("li[data-title]")].map((li) => li.textContent);
const summary = () => document.querySelector(".library-filter-summary")?.textContent ?? "";

test("search narrows the grid, counts and clears", async () => {
  const { unmount } = await render(
    <FilteredCollection collection="saved" title="Saved" entries={entries}>
      {(items) => (
        <ul>
          {items?.map((id) => (
            <li key={id} data-title>
              {entries.find((e) => e.id === id)!.name}
            </li>
          ))}
        </ul>
      )}
    </FilteredCollection>,
  );
  expect(shown()).toEqual(["Harbour Lights", "The Long Orbit"]);
  expect(summary()).toContain("2 titles");

  await type("sci-fi");
  expect(shown()).toEqual(["The Long Orbit"]);
  expect(summary()).toContain("1 of 2 titles");

  await type("nothing like it");
  expect(document.querySelector(".empty-state")?.textContent).toContain("Nothing in Saved matches “nothing like it”");
  await click(byText(document, ".empty-state button", "Clear Filters"));
  expect(shown()).toEqual(["Harbour Lights", "The Long Orbit"]);
  expect(document.querySelector<HTMLInputElement>(".library-filters input")!.value).toBe("");
  unmount();
});
