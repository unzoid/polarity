import { expect, test } from "bun:test";
import { batchShapes } from "../../src/lib/anime/anilist";
import { mediaBatchQuery } from "../../src/lib/anime/batch";

/**
 * The largest batches against AniList itself (#430): it answers a query over its complexity limit with an error
 * and no data. Off the network by default; `ANILIST_LIVE=1 bun test --preload ./tests/dom/setup.ts tests/dom/anilistComplexity.test.ts` runs it.
 */
const live = process.env.ANILIST_LIVE === "1";

for (const [name, { fields, most }] of Object.entries(batchShapes())) {
  test.skipIf(!live)(`the largest ${name} batch (${most} entries) is within AniList's complexity limit`, async () => {
    const ids = Array.from({ length: most }, (_, i) => i + 1);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: mediaBatchQuery(ids, fields) }),
    });
    const json = (await res.json()) as { errors?: { message: string }[] };
    expect((json.errors ?? []).map((e) => e.message).filter((m) => /complexity|max/i.test(m))).toEqual([]);
  }, 30_000);
}
