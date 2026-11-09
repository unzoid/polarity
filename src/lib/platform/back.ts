import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { inShell, type Unlisten } from "./bridge";
import { os } from "./device";
import { onBackSwipe, swipeGoesBack, type BackSwipe } from "./backSwipe";

/**
 * The system's Back: Android's back button and back gesture (a TV remote's Back too), and on iOS, which
 * has neither, a swipe in from the left edge (backSwipe.ts). Elsewhere the keyboard's Escape is Back and
 * nothing here runs. While an Android handler is registered the system no longer goes back or closes the
 * app by itself: the handler decides, and calls `leaveApp` at the root.
 */
export const systemBack: "button" | "swipe" | null = !inShell ? null : os === "android" ? "button" : os === "ios" ? "swipe" : null;

/**
 * A Back that follows the finger (iOS's swipe): `begin` says whether it takes this swipe (the page moves with it),
 * `move` how far it has come of `width`, `end` whether it goes back. A swipe it doesn't take calls the handler
 * when it ends far enough in, as a button press would.
 */
export type BackDrag = { begin(): boolean; move(x: number, width: number): void; end(back: boolean): void };

/** Hear the system's Back until the returned function is called; a no-op where there is none. */
export async function onSystemBack(handler: () => void, drag?: () => BackDrag | undefined): Promise<Unlisten> {
  if (systemBack === "swipe") return onBackSwipe(followSwipe(handler, drag));
  if (systemBack !== "button") return () => {};
  const listener = await onBackButtonPress(() => handler());
  return () => void listener.unregister();
}

/** The swipe's steps, to the drag while it has one, else to the handler once it ends far enough in. */
export function followSwipe(handler: () => void, drag?: () => BackDrag | undefined): (swipe: BackSwipe) => void {
  let taken: BackDrag | undefined;
  return (swipe) => {
    if (swipe.phase === "begin") {
      const d = drag?.();
      taken = d?.begin() ? d : undefined;
      taken?.move(swipe.x, swipe.width);
    } else if (swipe.phase === "move") {
      taken?.move(swipe.x, swipe.width);
    } else {
      const back = swipe.phase === "end" && swipeGoesBack(swipe);
      if (taken) taken.end(back);
      else if (back) handler();
      taken = undefined;
    }
  };
}

/**
 * Android's shell (gen/android MainActivity.kt) takes the window changes as messages on `polarActions`, which
 * only the app's own pages get; `polarDevice` is seen by every frame, a trailer's too, and carries these calls
 * only where the web view is too old for messages.
 */
type Actions = { postMessage?: (message: string) => void };
type LeaveBridge = { polarActions?: Actions; polarDevice?: { leave?: () => void } };

/**
 * Leave the app the way Back at the root does on Android: the activity goes to the background with the
 * system's transition (what Android 12 and later do on their own), and the app is there as it was when it's
 * opened again. Ending the process instead (`exit`, still the way where the bridge is missing) ran its exit
 * handlers while the web view's render threads were still drawing, and crashed it.
 */
export function leaveApp(scope: LeaveBridge = globalThis as LeaveBridge, quit: () => Promise<void> = () => exit(0)): Promise<void> {
  const actions = scope.polarActions;
  if (typeof actions?.postMessage === "function") {
    actions.postMessage("leave");
    return Promise.resolve();
  }
  const device = scope.polarDevice;
  if (typeof device?.leave === "function") {
    device.leave();
    return Promise.resolve();
  }
  return quit();
}

type ImmersiveBridge = { polarActions?: Actions; polarDevice?: { immersive?: (on: boolean) => void } };

/**
 * Hide Android's status and navigation bars while the player is open, and bring them back after (#178).
 * A swipe from the edge shows them for a moment, as in other video apps. Elsewhere there's no bridge and it
 * does nothing.
 */
export function setImmersive(on: boolean, scope: ImmersiveBridge = globalThis as ImmersiveBridge): void {
  try {
    if (typeof scope.polarActions?.postMessage === "function") scope.polarActions.postMessage(on ? "immersive:on" : "immersive:off");
    else scope.polarDevice?.immersive?.(on);
  } catch {
    // An older shell without the call: the bars stay, as before.
  }
}
