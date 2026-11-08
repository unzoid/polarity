import type { ComponentPropsWithRef } from "react";
import { ChevronLeft } from "./icons";
import { useTvMode } from "../tv/tvMode";

type BackButtonProps = Omit<ComponentPropsWithRef<"button">, "children" | "aria-label" | "title">;

/**
 * The one Back button (#348): the navbar's on the pages and the player's top bar draw this same button, so the two
 * look and press alike and can't drift apart. Both place it at the navbar's Back spot (`--nav-start`, `--back-top`
 * in styles/shell.css), so going into the player and back it doesn't move. `className` adds the surface's own
 * class: `navbar-back` (slides in and out), `player-back` (a shadow to read on the video).
 */
export function BackButton({ className, ...rest }: BackButtonProps) {
  // A remote has its own Back button, and no Esc (#431).
  const tv = useTvMode();
  return (
    <button className={className ? `back-button pressable ${className}` : "back-button pressable"} aria-label="Back" title={tv ? "Back" : "Back (Esc)"} {...rest}>
      <ChevronLeft size={22} strokeWidth={2.25} />
    </button>
  );
}
