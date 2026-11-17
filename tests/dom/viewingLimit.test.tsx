import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTitleVerdict, useViewingLimit } from "../../src/lib/catalog";
import { keys, useCatalog } from "../../src/lib/net";
import { setPrefs } from "../../src/lib/settings/prefs";
import type { MetaPreview } from "../../src/lib/types";
import { render } from "./render";

afterEach(() => setPrefs({ viewingLimit: 0, viewingHideUnrated: false }, { quiet: true }));

const items: MetaPreview[] = [
  { id: "tt0000021", type: "movie", name: "Paper Kites", certification: "PG" },
  { id: "tt0000022", type: "movie", name: "Night Ferry", certification: "R" },
  { id: "tt0000023", type: "movie", name: "Unrated Reel" },
];

function Row() {
  const { data } = useCatalog("movie", "popular");
  return (
    <ul>
      {data?.map((m) => (
        <li key={m.id}>{m.name}</li>
      ))}
    </ul>
  );
}

function Page({ item, settled }: { item?: MetaPreview; settled: boolean }) {
  const { limit, hideUnrated } = useViewingLimit();
  return <p data-limit={limit ?? "none"} data-unrated={hideUnrated}>{useTitleVerdict(item, settled)}</p>;
}

const client = () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });

test("viewing limit: shelves leave out titles above it, and unrated ones only when asked", async () => {
  const qc = client();
  qc.setQueryData(keys.catalog("movie", "popular"), items);
  const view = await render(
    <QueryClientProvider client={qc}>
      <Row />
    </QueryClientProvider>,
  );
  const names = () => [...view.container.querySelectorAll("li")].map((li) => li.textContent);
  expect(names()).toEqual(["Paper Kites", "Night Ferry", "Unrated Reel"]);
  await act(async () => setPrefs({ viewingLimit: 12 }, { quiet: true }));
  expect(names()).toEqual(["Paper Kites", "Unrated Reel"]);
  await act(async () => setPrefs({ viewingHideUnrated: true }, { quiet: true }));
  expect(names()).toEqual(["Paper Kites"]);
  // What's cached stays whole: paging and other readers see every title.
  expect(qc.getQueryData<MetaPreview[]>(keys.catalog("movie", "popular"))).toHaveLength(3);
  await view.unmount();
});

test("viewing limit: a title page shows, waits for the rating, or says it's over the limit", async () => {
  const view = await render(<Page item={items[1]} settled={false} />);
  const p = () => view.container.querySelector("p")!;
  expect(p().textContent).toBe("show");
  expect(p().dataset.limit).toBe("none");
  // The switch for unrated titles means nothing without a limit.
  await act(async () => setPrefs({ viewingHideUnrated: true }, { quiet: true }));
  expect(p().dataset.unrated).toBe("false");
  await act(async () => setPrefs({ viewingLimit: 16 }, { quiet: true }));
  expect(p().textContent).toBe("wait");
  await view.unmount();
  const settled = await render(<Page item={items[1]} settled />);
  expect(settled.container.querySelector("p")!.textContent).toBe("hide");
  await settled.unmount();
});
