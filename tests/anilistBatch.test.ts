import { expect, test } from "bun:test";
import { createBatcher, mediaBatchQuery, SplitBatch, TooComplex } from "../src/lib/anime/batch";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("questions asked together go in one request, each getting its own answer (#430)", async () => {
  const sent: number[][] = [];
  const batch = createBatcher<string>({
    max: 10,
    wait: 5,
    send: async (ids) => (sent.push(ids), new Map(ids.map((id) => [id, `entry ${id}`]))),
  });
  const answers = await Promise.all([batch.ask(1), batch.ask(2), batch.ask(3), batch.ask(2)]);
  expect(answers).toEqual(["entry 1", "entry 2", "entry 3", "entry 2"]);
  expect(sent).toEqual([[1, 2, 3]]);
});

test("a batch never holds more than its most, and the rest follow in the next", async () => {
  const sent: number[][] = [];
  const batch = createBatcher<number>({ max: 3, wait: 5, send: async (ids) => (sent.push(ids), new Map(ids.map((id) => [id, id * 10]))) });
  const answers = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((id) => batch.ask(id)));
  expect(answers).toEqual([10, 20, 30, 40, 50, 60, 70]);
  expect(sent).toEqual([
    [1, 2, 3],
    [4, 5, 6],
    [7],
  ]);
});

test("a batch AniList finds too complex is split in halves until it goes", async () => {
  const sent: number[][] = [];
  const batch = createBatcher<number>({
    max: 8,
    wait: 5,
    send: async (ids) => {
      sent.push(ids);
      if (ids.length > 2) throw new TooComplex("Max query complexity exceeded");
      return new Map(ids.map((id) => [id, id]));
    },
  });
  const answers = await Promise.all([1, 2, 3, 4, 5].map((id) => batch.ask(id)));
  expect(answers).toEqual([1, 2, 3, 4, 5]);
  expect(sent).toEqual([[1, 2, 3, 4, 5], [1, 2], [3, 4, 5], [3], [4, 5]]);
});

test("an entry AniList doesn't have fails alone; another error fails the batch's questions", async () => {
  const batch = createBatcher<number>({ max: 8, wait: 5, send: async (ids) => new Map(ids.filter((id) => id !== 2).map((id) => [id, id])) });
  const [one, two] = await Promise.allSettled([batch.ask(1), batch.ask(2)]);
  expect(one).toEqual({ status: "fulfilled", value: 1 });
  expect(two.status).toBe("rejected");
  const down = createBatcher<number>({ max: 8, wait: 5, send: async () => Promise.reject(new Error("AniList answered 500")) });
  const all = await Promise.allSettled([down.ask(1), down.ask(2)]);
  expect(all.map((r) => r.status)).toEqual(["rejected", "rejected"]);
});

test("asked apart in time, questions go apart", async () => {
  const sent: number[][] = [];
  const batch = createBatcher<number>({ max: 8, wait: 5, send: async (ids) => (sent.push(ids), new Map(ids.map((id) => [id, id]))) });
  await batch.ask(1);
  await tick(10);
  await batch.ask(2);
  expect(sent).toEqual([[1], [2]]);
});

test("the request names each entry by an alias of its id", () => {
  const q = mediaBatchQuery([11, 22], "id title { romaji }");
  expect(q).toBe("query { m11: Media(id: 11, type: ANIME) { id title { romaji } } m22: Media(id: 22, type: ANIME) { id title { romaji } } }");
});

test("one asked more urgently goes on its own, ahead of the others' batch (#380)", async () => {
  const sent: [number[], number | undefined][] = [];
  const batch = createBatcher<number>({
    max: 10,
    wait: 5,
    send: async (ids, p) => (sent.push([ids, typeof p === "function" ? p() : p]), new Map(ids.map((id) => [id, id]))),
  });
  await Promise.all([batch.ask(1, 1), batch.ask(2, 2), batch.ask(3, 2), batch.ask(2, 1)]);
  expect(sent).toEqual([
    [[1], 1],
    [[2, 3], 1],
  ]);
});

test("a batch AniList leaves out whole for one missing entry is asked in parts, and only that one fails", async () => {
  const sent: number[][] = [];
  const batch = createBatcher<number>({
    max: 8,
    wait: 5,
    // As AniList answers: one id it doesn't have, and every alias comes back null.
    send: async (ids) => {
      sent.push(ids);
      if (ids.includes(3) && ids.length > 1) throw new SplitBatch("whole batch left out");
      return new Map(ids.filter((id) => id !== 3).map((id) => [id, id]));
    },
  });
  const results = await Promise.allSettled([1, 2, 3, 4].map((id) => batch.ask(id)));
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
  expect(sent).toEqual([[1, 2, 3, 4], [1, 2], [3, 4], [3], [4]]);
});
