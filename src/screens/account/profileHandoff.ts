import { cssEase, ease, prefersReducedMotion } from "../../lib/ui";

/**
 * Picking a profile hands over to the app: the picker stays on top of it for PROFILES_EXIT_MS (App's
 * Gate) while its backdrop fades and the chosen avatar flies into the navbar's profile button.
 */
const FLIGHT_MS = 500;
export const PROFILES_EXIT_MS = FLIGHT_MS + 220;

/** Where the avatar lands: DeskApp's bar, the classic navbar's profile button, or TV mode's. */
const TARGET = ".dk-profile-btn .avatar, .navbar-profile .avatar, .tv-nav-me .avatar";

function findTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(TARGET)) {
    // Note: <Avatar> carries aria-hidden itself (decorative), so only skip hidden/inert *ancestors*.
    if (el.closest("[inert], .dk-profile-legacy") || el.parentElement?.closest("[aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** True once the destination navbar avatar is mounted and laid out. */
export const hasNavbarTarget = () => !!findTarget();

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
 * neither the picker's scrolling area nor its unmounting cuts it short; `:root[data-profile-handoff]`
 * keeps the destination avatar hidden until landing so it never flashes beforehand. With nowhere to
 * land (the phone's native tabs) or reduced motion, returns `false` so the avatar fades with the picker.
 */
export function flyToNavbar(avatar: HTMLElement): boolean {
  const target = findTarget();
  if (!target || prefersReducedMotion()) return false;

  const from = avatar.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  // Measured as laid out, without the chosen tile's scale (its origin is the centre, so the centre holds).
  const size = avatar.offsetWidth;
  if (!size || !to.width) return false;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const dx = to.left + to.width / 2 - cx;
  const dy = to.top + to.height / 2 - cy;
  const s0 = from.width / size;
  const s1 = to.width / size;
  const r0 = radiusPx(avatar, size);

  const copy = avatar.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, {
    position: "fixed",
    left: `${cx - size / 2}px`,
    top: `${cy - size / 2}px`,
    width: `${size}px`,
    margin: "0",
    borderRadius: `${r0}px`,
    zIndex: "var(--z-popover)",
    pointerEvents: "none",
    willChange: "transform",
  });
  document.documentElement.dataset.profileHandoff = "";
  document.body.appendChild(copy);
  avatar.style.visibility = "hidden";

  // A quadratic Bézier from the start (0, 0) through the bend to the landing spot; transform-only
  // (no borderRadius keyframes) so the entire flight stays on the GPU compositor thread even during
  // first-boot Home mount.
  const keyframes: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const bend = 2 * (1 - t) * t;
    const x = bend * dx * BEND.across + t * t * dx;
    const y = bend * dy * BEND.up + t * t * dy;
    const s = s0 + (s1 - s0) * t;
    keyframes.push({ offset: t, transform: `translate3d(${x}px, ${y}px, 0) scale(${s})` });
  }

  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    window.clearTimeout(guard);
    delete document.documentElement.dataset.profileHandoff;
    copy.remove();
  };
  const guard = window.setTimeout(land, FLIGHT_MS + 120);
  copy.animate(keyframes, { duration: FLIGHT_MS, easing: cssEase(ease.inOut), fill: "forwards" }).finished.then(land, land);
  return true;
}
