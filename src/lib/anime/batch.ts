import type { Priority } from "../net/limiter";

/**
 * AniList questions about single entries, asked together (#430): AniList counts requests, not entries, against
 * its limit (90 a minute, 30 in its reduced mode), and its GraphQL takes several entries in one request under
 * aliases. Questions asked within `wait` ms of each other at the same priority go in one request of at most `max`
 * entries (one asked more urgently, like the banner's first slide, #380, keeps its own). One that can't go whole
 * ({@link SplitBatch}) is split in halves until each part goes.
 */
export class SplitBatch extends Error {}

/** AniList found the request over its complexity limit. */
export class TooComplex extends SplitBatch {}

/** AniList's error for a request over its query complexity limit. */
export const isTooComplex = (message: string) => /complexity/i.test(message);

/** One request for several entries' `fields`, each under the alias `m<id>`. */
export function mediaBatchQuery(ids: number[], fields: string) {
  return `query { ${ids.map((id) => `m${id}: Media(id: ${id}, type: ANIME) { ${fields.trim()} }`).join(" ")} }`;
}

interface Waiting<T> {
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function createBatcher<T>({
  max,
  wait,
  send,
}: {
  max: number;
  wait: number;
  /**
   * Asks for `ids` in one request, at `priority` (the most urgent of the batch's): each id's answer, missing for one
   * AniList doesn't have. Throws {@link SplitBatch} for a request to be asked again in parts.
   */
  send: (ids: number[], priority: Priority | undefined) => Promise<Map<number, T>>;
}) {
  interface Group {
    queue: Map<number, Waiting<T>[]>;
    priorities: Priority[];
  }
  let groups = new Map<number | undefined, Group>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const level = (p: Priority) => (typeof p === "function" ? p() : p);
  // The batch goes at its most urgent member's priority, read when its turn comes.
  const most = (ps: Priority[]): Priority | undefined => (ps.length ? () => Math.min(...ps.map(level)) : undefined);

  async function go(ids: number[], waiting: Map<number, Waiting<T>[]>, priority: Priority | undefined): Promise<void> {
    let answers: Map<number, T>;
    try {
      answers = await send(ids, priority);
    } catch (e) {
      if (e instanceof SplitBatch && ids.length > 1) {
        const half = Math.floor(ids.length / 2);
        await go(ids.slice(0, half), waiting, priority);
        await go(ids.slice(half), waiting, priority);
        return;
      }
      for (const id of ids) for (const w of waiting.get(id) ?? []) w.reject(e);
      return;
    }
    for (const id of ids) {
      const a = answers.get(id);
      for (const w of waiting.get(id) ?? []) {
        if (a === undefined) w.reject(new Error(`AniList has no anime ${id}`));
        else w.resolve(a);
      }
    }
  }

  function flush() {
    timer = undefined;
    const all = groups;
    groups = new Map();
    for (const { queue, priorities } of all.values()) {
      const ids = [...queue.keys()];
      for (let i = 0; i < ids.length; i += max) void go(ids.slice(i, i + max), queue, most(priorities));
    }
  }

  return {
    ask(id: number, priority?: Priority): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        // An entry already waiting is asked once, in the batch it's in, at the more urgent of the two.
        let group = [...groups.values()].find((g) => g.queue.has(id));
        if (!group) {
          const key = priority === undefined ? undefined : level(priority);
          group = groups.get(key) ?? { queue: new Map(), priorities: [] };
          groups.set(key, group);
        }
        const list = group.queue.get(id);
        if (list) list.push({ resolve, reject });
        else group.queue.set(id, [{ resolve, reject }]);
        if (priority !== undefined) group.priorities.push(priority);
        timer ??= setTimeout(flush, wait);
      });
    },
  };
}
