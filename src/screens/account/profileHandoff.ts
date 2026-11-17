import { cssEase, ease, prefersReducedMotion } from "../../lib/ui";

/**
 * Picking a profile hands over to the app: the picker stays on top of it for PROFILES_EXIT_MS (App's
 * Gate) while its backdrop fades and the chosen avatar flies into the navbar's profile button.
 */
const FLIGHT_MS = 500;
export const PROFILES_EXIT_MS = FLIGHT_MS + 80;

/** Where the avatar lands: the desktop navbar's profile button, or TV mode's. */
const TARGET = ".navbar-profile .avatar, .tv-nav-me .avatar";

/**
 * The flight's path bends: its control point sits this far along the way across and up, so the
 * avatar lifts off first and then sweeps over into the corner rather than sliding in a straight line.
 */
const BEND = { across: 0.2, up: 0.8 };
/** Points sampled along the path; straight between them, which reads as a smooth curve at this size. */
const STEPS = 32;

/** A corner radius in px; `.avatar`'s own is a percentage of its width. */
function radiusPx(el: HTMLElement, width: number) {
  const r = getComputedStyle(el).borderTopLeftRadius;
  return r.endsWith("%") ? (parseFloat(r) / 100) * width : parseFloat(r) || 0;
}

/**
 * Flies `avatar` into the navbar's. A copy flies, fixed to the window and outliving the picker, so
 * neither the picker's scrolling area nor its unmounting cuts it short; the landing spot stays hidden
 * until it arrives. With nowhere to land (the phone's native tabs) or reduced motion, nothing flies:
 * the avatar fades out with the picker.
 */
export function flyToNavbar(avatar: HTMLElement) {
  const target = document.querySelector<HTMLElement>(TARGET);
  if (!target || prefersReducedMotion()) return;

  const from = avatar.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  // Measured as laid out, without the chosen tile's scale (its origin is the centre, so the centre holds).
  const size = avatar.offsetWidth;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const dx = to.left + to.width / 2 - cx;
  const dy = to.top + to.height / 2 - cy;
  const s0 = from.width / size;
  const s1 = to.width / size;
  // The copy is scaled, which scales its corners too: give it, at each point, the radius that shows
  // as the avatar's at the start and as the navbar's on landing, so nothing re-rounds once it's there.
  const r0 = radiusPx(avatar, size);
  const r1 = radiusPx(target, target.offsetWidth) / s1;

  const copy = avatar.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, {
    position: "fixed",
    left: `${cx - size / 2}px`,
    top: `${cy - size / 2}px`,
    width: `${size}px`,
    margin: "0",
    zIndex: "var(--z-overlay)",
    pointerEvents: "none",
  });
  document.body.appendChild(copy);
  avatar.style.visibility = "hidden";
  target.style.visibility = "hidden";

  // A quadratic Bézier from the start (0, 0) through the bend to the landing spot; the scale and the
  // radius go along with it. The timing curve applies to the whole flight, over these points.
  const keyframes: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const bend = 2 * (1 - t) * t;
    const x = bend * dx * BEND.across + t * t * dx;
    const y = bend * dy * BEND.up + t * t * dy;
    const s = s0 + (s1 - s0) * t;
    keyframes.push({ offset: t, transform: `translate(${x}px, ${y}px) scale(${s})`, borderRadius: `${r0 + (r1 - r0) * t}px` });
  }

  const land = () => {
    target.style.visibility = "";
    copy.remove();
  };
  copy.animate(keyframes, { duration: FLIGHT_MS, easing: cssEase(ease.inOut), fill: "forwards" }).finished.then(land, land);
}
