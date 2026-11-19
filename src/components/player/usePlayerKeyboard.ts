import { useEffect, useRef } from "react";
import { actionFor, type Action } from "../../lib/settings";
import { dismissTop } from "../../lib/ui";
import { focusEl, KEY_DIRS, move, navigables } from "../../tv/spatial";
import { isTvMode } from "../../tv/tvMode";

/** Keys that back out of the player: Esc always; in TV mode also Backspace and a remote's Back, as on the other TV screens. */
function isBack(e: KeyboardEvent): boolean {
  if (e.key === "Escape") return true;
  return isTvMode() && (e.key === "Backspace" || e.key === "GoBack" || e.key === "BrowserBack");
}

const PROMPT_ZONES = ".next-up, .skip-button, .rating-prompt, .player-status, .sleep-prompt, .sleep-ended";
const CHROME_ZONES = ".player-bottom, .player-top, .player-center, .player-yt-bar";

/**
 * The player's keyboard: shortcuts as bound in Settings → Controls, and Esc
 * (on TV also Backspace and Back), which always backs out. `onAction` returns whether it handled the key; it
 * may change every render (the listener is bound once and calls the latest).
 * Instant, never animated: `onHandled` runs after each handled key, with its action,
 * and `onOther` after any other key the player hears (Tab, a key bound to nothing).
 */
export function usePlayerKeyboard(
  enabled: boolean,
  onAction: (action: Action | "escape") => boolean,
  onHandled: (action: Action | "escape") => void,
  onOther?: () => void,
) {
  const latest = useRef({ onAction, onHandled, onOther });
  latest.current = { onAction, onHandled, onOther };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const target = e.target as HTMLElement | null;
      // A dropdown has the keyboard while it's focused or open (arrows, Space, Esc are its own).
      if (target?.closest?.("[aria-haspopup=listbox], [role=listbox], .srcf-popover")) return;
      // So does an open menu (the top bar's "More", #396).
      if (target?.closest?.("[role=menu]")) return;
      // A watch party's link question (PartyHost) is over the player and holds focus: its keys are its own.
      if (target?.closest?.(".party-link-confirm")) return;
      // A source's info panel (#229) and a TV source row's menu hold focus over the player the same way.
      if (target?.closest?.(".source-info, .tv-source-menu")) {
        // A remote's Back closes them as Esc does (lib/ui/dismiss.ts hears only Esc).
        if (isBack(e) && e.key !== "Escape" && dismissTop()) e.preventDefault();
        return;
      }
      // A remote's Back closes an open panel first (Escape does through the dismiss stack before it gets
      // here), as on TV's other screens: a panel beside YouTube's player (#434) keeps no focus trap to stop it.
      if (isBack(e) && e.key !== "Escape" && dismissTop()) {
        e.preventDefault();
        return;
      }

      const dir = KEY_DIRS[e.key];
      const tv = isTvMode();
      const bareFocus = !target || target === document.body || target === document.documentElement || target.classList.contains("player");

      if (dir) {
        const inPrompt = !!target?.closest?.(PROMPT_ZONES);
        const inChrome = !!target?.closest?.(CHROME_ZONES);
        if (inPrompt || inChrome) {
          const player = target?.closest?.(".player");
          const chromeActive = !player || (player.getAttribute("data-chrome") !== "false" && (tv || player.hasAttribute("data-key-focus")));
          if (inPrompt || chromeActive) {
            e.preventDefault();
            move(dir);
            latest.current.onOther?.();
            return;
          }
        }
        // 5-button TV remote: when chrome is visible and nothing is focused, ArrowDown enters the bottom controls.
        if (tv && bareFocus && dir === "down") {
          const player = document.querySelector<HTMLElement>('.player[data-chrome="true"]');
          const bottom = player?.querySelector<HTMLElement>(".player-bottom");
          const first = bottom ? (navigables(bottom.querySelector(".player-actions") ?? bottom)[0] ?? navigables(bottom)[0]) : null;
          if (first) {
            e.preventDefault();
            focusEl(first);
            latest.current.onOther?.();
            return;
          }
        }
      }

      // 5-button TV remote: Enter on the bare picture toggles play/pause and wakes chrome.
      if (tv && bareFocus && e.key === "Enter") {
        if (latest.current.onAction("playPause")) {
          e.preventDefault();
          latest.current.onHandled("playPause");
          return;
        }
      }

      const action = isBack(e) ? "escape" : actionFor(e, "player");
      if (action && latest.current.onAction(action)) {
        e.preventDefault();
        latest.current.onHandled(action);
      } else latest.current.onOther?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
