import { orderLabel, type EpisodeOrders } from "../lib/library";

/**
 * TV's "Episode order" choice above the seasons (lib/library/episodeOrder.ts): As Aired and the orders TMDB lists
 * for the show, drawn like the seasons. Nothing when TMDB lists none.
 */
export function TvEpisodeOrders({ orders }: { orders: EpisodeOrders }) {
  if (!orders.orders.length) return null;
  const choices = [{ id: null as string | null, label: "As Aired" }, ...orders.orders.map((o) => ({ id: o.id as string | null, label: orderLabel(o) }))];
  return (
    <div className="tv-seasons tv-episode-orders" role="radiogroup" aria-label="Episode order" data-nav-memory>
      {choices.map((c) => (
        <button
          key={c.id ?? "aired"}
          className="tv-season"
          role="radio"
          aria-checked={c.id === orders.chosen}
          aria-current={c.id === orders.chosen || undefined}
          onClick={() => orders.choose(c.id)}
        >
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}
