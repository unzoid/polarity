import { routeTitle } from "../../../src/lib/navTabs";
import type { Route } from "../../../src/lib/router";

/** A page the redesign hasn't built yet: says which, and that the current app still has it. */
export function NotYet({ route }: { route: Route }) {
  const name = route.name === "player" ? "The player" : routeTitle(route) || "This page";
  return (
    <div className="empty page-enter">
      <p className="t-section">{name}</p>
      <p className="muted">Not built in the redesign yet. The current app still has it.</p>
    </div>
  );
}
