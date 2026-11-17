import { orderLabel, type EpisodeOrders } from "../../lib/library";
import { Dropdown } from "../Dropdown";

/** The "as aired" choice's value: TMDB's order ids are hex, so never this. */
const AIRED = "aired";

/**
 * Which order a series' episodes are listed and followed in (lib/library/episodeOrder.ts), beside the season
 * picker. Only drawn when TMDB lists other orders for the show.
 */
export function EpisodeOrderPicker({ orders }: { orders: EpisodeOrders }) {
  if (!orders.orders.length) return null;
  return (
    <div className="episode-order-picker">
      <Dropdown
        label="Episode order"
        value={orders.chosen ?? AIRED}
        onChange={(v) => orders.choose(v === AIRED ? null : v)}
        options={[{ value: AIRED, label: "As Aired" }, ...orders.orders.map((o) => ({ value: o.id, label: orderLabel(o) }))]}
      />
    </div>
  );
}
