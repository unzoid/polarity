/**
 * A franchise's seasons from AniList's prequel/sequel links (test report 1, items 8 and 12). Pure:
 * the network comes in as `link`, so tests walk made-up franchises.
 */
import type { AnimeCard, ChainLink, MediaFormat } from "./anilist";
import { sameSplitEntry } from "./splitParts";

export interface AnimeSeason {
  card: AnimeCard;
  label: string;
}

/** Kinds of entry that can be a "season" of a franchise. OVAs, specials and recaps never are. */
const SEASON_FORMATS = new Set<MediaFormat>(["TV", "TV_SHORT", "ONA", "MOVIE"]);
/** Long franchises (Ginbou, Kotodama) have many entries; nobody's has this many. */
const MAX_HOPS = 20;
/** An ONA or short this long or shorter is a side story (Salt Horizon's one-episode LANTERNS), not a season. */
const SIDE_STORY_EPISODES = 3;

/**
 * Whether an entry is one of the franchise's seasons: a TV run or a film, or a web series or short
 * with a real run. A one-off ONA set before the show is stepped through like an OVA, so it never
 * takes "Season 1" from the show (AniList's PREQUEL means "comes before", not "the season before").
 * An entry whose length isn't known yet (still airing) counts.
 */
export function isSeason(card: Pick<AnimeCard, "format" | "episodes">): boolean {
  if (!card.format || !SEASON_FORMATS.has(card.format)) return false;
  if (card.format === "ONA" || card.format === "TV_SHORT") return card.episodes == null || card.episodes > SIDE_STORY_EPISODES;
  return true;
}

/**
 * Whether no season comes before `anime` (its relations): with seasons as separate shows, only such an entry's
 * page takes its art from the title it plays from; a later one's is its own (AnimeDetail.tsx, pageArt.ts).
 */
export function noSeasonBefore(anime: Pick<ChainLink, "relations">): boolean {
  return !anime.relations.edges.some((e) => e.relationType === "PREQUEL" && e.node.type !== "MANGA" && isSeason(e.node));
}

export interface SeasonWalk {
  seasons: AnimeSeason[];
  /** Every entry along the prequel/sequel links in watch order, the OVAs and specials between seasons too (#193). */
  order: AnimeCard[];
  /** False when a step failed (AniList busy): the seasons found so far, to be asked again later. */
  complete: boolean;
}

/**
 * A part that isn't out yet and of which nothing is known: no start date, no schedule, no story. It
 * gets no tab and no Watch Order card, as lists leave such titles out (#337, #351). A card that came
 * without its story (`description` undefined) isn't known to have none, so it stays.
 */
export function nothingKnownYet(card: Pick<AnimeCard, "status" | "startDate" | "nextAiringEpisode" | "description">): boolean {
  return card.status === "NOT_YET_RELEASED" && !card.startDate?.year && !card.nextAiringEpisode && card.description !== undefined && !card.description?.trim();
}

/** "… Season 3: Arc Part 1" → "… Season 3: Arc Part 2": the name a later part of a split entry takes from the part before it. */
const nextPartName = (name: string) => name.replace(/\b(part|cour)\s+(\d+)$/i, (_, word: string, n: string) => `${word} ${Number(n) + 1}`);

/**
 * The franchise around `root` in watch order: AniList links each entry only to its direct prequel
 * and sequel, so the chain is walked one hop at a time. The seasons are read walking forward from
 * the franchise's first entry, so every entry's page finds the same ones (#351): back from `root`
 * to the start, then forward from there, with what the walk forward from `root` found meanwhile
 * saving the requests. Only an entry off that path (a branch) keeps the chain found through it.
 * An entry that came with its neighbours' details (`full`) saves a request per hop. A hop that
 * fails ends that way with what was found instead of failing the whole list.
 *
 * `root` is a tab only when it's a season like the others: an OVA or a part nothing is known of
 * opens on its own.
 */
export async function walkSeasons(root: ChainLink, link: (id: number) => Promise<ChainLink>): Promise<SeasonWalk> {
  const known = new Map([[root.id, root]]);
  let complete = true;
  const walk = async (from: ChainLink, way: "PREQUEL" | "SEQUEL", hops: number) => {
    const seen = new Set([from.id]);
    const out: ChainLink[] = [];
    let at = from;
    for (let hop = 0; hop < hops; hop++) {
      const next = at.relations.edges
        .filter((e) => e.relationType === way && e.node.type !== "MANGA" && !seen.has(e.node.id))
        // Several prequels (a film and a series): follow the series.
        .sort((a, b) => Number(!SEASON_FORMATS.has(a.node.format!)) - Number(!SEASON_FORMATS.has(b.node.format!)))[0];
      if (!next) break;
      seen.add(next.node.id);
      try {
        at = known.get(next.node.id) ?? next.node.full ?? (await link(next.node.id));
      } catch {
        complete = false;
        break;
      }
      known.set(at.id, at);
      out.push(at);
    }
    return out;
  };
  const [before, after] = await Promise.all([walk(root, "PREQUEL", MAX_HOPS), walk(root, "SEQUEL", MAX_HOPS)]);
  const first = before.at(-1) ?? root;
  const forward = [first, ...(await walk(first, "SEQUEL", 2 * MAX_HOPS))];
  // A branch the walk forward doesn't take (two sequels, `root` on the other one): the chain through `root`, as it was found.
  const through = forward.some((n) => n.id === root.id) ? forward : [...before.reverse(), root, ...after];
  const found = through.filter((n) => !nothingKnownYet(n));
  // A later part of a split entry with no English title yet is named after the part before it.
  const all: ChainLink[] = [];
  for (const n of found) {
    const prev = all.at(-1);
    const english = !n.title.english && prev?.title.english && sameSplitEntry(n, prev) ? nextPartName(prev.title.english) : undefined;
    all.push(english && english !== prev?.title.english ? { ...n, title: { ...n.title, english } } : n);
  }
  // A short first part of a split entry ("… - 1st Leg" before "… - 2nd Leg") is a season like the rest of it, and
  // so is an announced part whose format AniList hasn't set yet.
  const part = (n: ChainLink, i: number) => [all[i - 1], all[i + 1]].some((m) => !!m && m.format !== "MOVIE" && isSeason(m) && sameSplitEntry(n, m));
  const chain = all.filter((n, i) => (n.format == null || SEASON_FORMATS.has(n.format)) && (isSeason(n) || part(n, i)));
  let season = 0;
  return {
    seasons: chain.map((card) => ({ card, label: card.format === "MOVIE" ? "Movie" : `Season ${++season}` })),
    order: all,
    complete,
  };
}
