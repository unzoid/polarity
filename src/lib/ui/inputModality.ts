/**
 * Which hand is on the app right now, as `<html data-input="keyboard|pointer">`: keys since the last mouse
 * move, or a mouse (or finger) since the last key. CSS uses it where `:focus-visible` can't tell: a Base UI menu
 * moves focus onto the row under the mouse itself, which the browser counts as keyboard focus.
 */
let started = false;

function set(input: "keyboard" | "pointer") {
  const root = document.documentElement;
  if (root.dataset.input !== input) root.dataset.input = input;
}

const onKey = (e: KeyboardEvent) => {
  // A modifier on its own (Alt-tabbing away, Ctrl for a shortcut) says nothing about where the hand is.
  if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") set("keyboard");
};
const onPointer = () => set("pointer");

/** Starts tracking. Once per app. */
export function watchInputModality() {
  if (started || typeof document === "undefined") return;
  started = true;
  document.documentElement.dataset.input = "pointer";
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointermove", onPointer, { capture: true, passive: true });
  document.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
}
