/**
 * While a direction is held (a key's auto-repeat, a D-pad's repeat), focus moves
 * every 45–180 ms: faster than the focus ring and the card lift can finish, so
 * they never settle and you can't see where you are. `data-nav-held` on the root
 * says a held move is running; tv.css makes those transitions instant until it's
 * gone, a little after the last repeat (above slow gamepad repeat's 180 ms).
 */
const SETTLE_MS = 230;
let timer = 0;

export function markHeldMove() {
  // Set once per hold: setting it again each repeat would restyle the whole page each time.
  if (!document.documentElement.hasAttribute("data-nav-held")) document.documentElement.setAttribute("data-nav-held", "");
  window.clearTimeout(timer);
  timer = window.setTimeout(() => document.documentElement.removeAttribute("data-nav-held"), SETTLE_MS);
}
