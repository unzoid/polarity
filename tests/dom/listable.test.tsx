import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useListable } from "../../src/lib/catalog";
import { keys } from "../../src/lib/net";
import { markImageBroken } from "../../src/lib/ui";
import type { MetaPreview } from "../../src/lib/types";
import { render } from "./render";

const art = (n: string) => ({ poster: `https://media.example.com/${n}-poster.jpg`, background: `https://media.example.com/${n}-backdrop.jpg` });

const items: MetaPreview[] = [
  { id: "tt0000011", type: "series", name: "Bare Stub", releaseInfo: "2017" },
  { id: "tt0000012", type: "series", name: "Blank Frame", ...art("blank") },
  { id: "tt0000013", type: "movie", name: "Artless Film", description: "A ferry crossing in fog.", imdbRating: "6.1" },
  { id: "tt0000014", type: "series", name: "Announced Show", description: "Coming next year.", ...art("announced") },
  { id: "tt0000015", type: "series", name: "Known Episodes" },
];

function List({ items }: { items: MetaPreview[] }) {
  const shown = useListable(items);
  return (
    <ul>
      {shown?.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  );
}

test("useListable: unplayable titles with nothing to show drop out, a blank card once its pictures fail (#337)", async () => {
  const qc = new QueryClient();
  // Details already in the cache (opened before): it has an episode, so Play works.
  qc.setQueryData(keys.meta("series", "tt0000015"), { ...items[4], videos: [{ id: "tt0000015:1:1", title: "One", season: 1, episode: 1 }] });
  const view = await render(
    <QueryClientProvider client={qc}>
      <List items={items} />
    </QueryClientProvider>,
  );
  const names = () => [...view.container.querySelectorAll("li")].map((li) => li.textContent);
  expect(names()).toEqual(["Blank Frame", "Artless Film", "Announced Show", "Known Episodes"]);

  // The poster fails: the backdrop may still load.
  await act(async () => markImageBroken(art("blank").poster));
  expect(names()).toContain("Blank Frame");
  await act(async () => {
    markImageBroken(art("blank").background);
    markImageBroken(art("announced").poster);
    markImageBroken(art("announced").background);
  });
  expect(names()).toEqual(["Artless Film", "Announced Show", "Known Episodes"]);
  await view.unmount();
});
