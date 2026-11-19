import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { call, inShell, type Unlisten } from "./bridge";
import { os } from "./device";
import { onBackSwipe, swipeGoesBack, type BackSwipe } from "./backSwipe";

/**
 * The system's Back: Android's back button and back gesture (a TV remote's Back too), and on iOS, which
 * has neither, a swipe in from the left edge (backSwipe.ts). Elsewhere the keyboard's Escape is Back and
 * nothing here runs. While an Android handler is registered the system no longer goes back or closes the
 * app by itself: the handler decides, and calls `leaveApp` at the root. On Android 14 and later the back gesture
 * also reports its steps as it moves (onPredictiveBack), so the page can follow the finger as on iOS (#483).
 */
export const systemBack: "button" | "swipe" | null = !inShell ? null : os === "android" ? "button" : os === "ios" ? "swipe" : null;

/**
 * A Back that follows the finger (iOS's swipe, Android's back gesture): `begin` says whether it takes this swipe (the page moves with it),
 * `move` how far it has come of `width`, `end` whether it goes back. A swipe it doesn't take calls the handler
 * when it ends far enough in, as a button press would.
 */
export type BackDrag = { begin(): boolean; move(x: number, width: number): void; end(back: boolean): void };

/** Hear the system's Back until the returned function is called; a no-op where there is none. */
export async function onSystemBack(handler: () => void, drag?: () => BackDrag | undefined): Promise<Unlisten> {
  if (systemBack === "swipe") return onBackSwipe(followSwipe(handler, drag));
  if (systemBack !== "button") return () => {};
  const listener = await onBackButtonPress(() => handler());
  const offPredictive = onPredictiveBack(followPredictive(handler, drag));
  return () => {
    offPredictive();
    void listener.unregister();
  };
}

/**
 * Android 14 and later's back gesture as it moves (gen/android MainActivity.kt): `begin` when the finger starts in from
 * an edge, `move` as it goes, with `progress` from 0 to 1 as Android measures it, then `cancel` when it is let go
 * early, or `back` once it goes back. A back button, a TV remote's Back or an older Android sends only `back`.
 */
export type PredictiveBack = { phase: "begin" | "move" | "cancel" | "back"; progress: number };

/** The `polar-back` window events MainActivity.kt sends into the page's main frame only. */
export const PREDICTIVE_BACK_EVENT = "polar-back";

type PredictiveBridge = { polarActions?: Actions; addEventListener: Window["addEventListener"]; removeEventListener: Window["removeEventListener"] };

/** Hearers of the gesture now; Android sends it while there is at least one, else its Back goes the Tauri way. */
let predictiveHearers = 0;

/**
 * Hear Android's back gesture step by step until the returned function is called. While anything hears it the activity
 * sends every Back here (not to Tauri's back button event), so a press comes as `back` too. A web view too old for
 * messages has no gesture: nothing comes, and Back stays the button press it was.
 */
export function onPredictiveBack(handler: (step: PredictiveBack) => void, scope: PredictiveBridge = globalThis as unknown as PredictiveBridge): Unlisten {
  const actions = scope.polarActions;
  if (typeof actions?.postMessage !== "function") return () => {};
  const listener = (e: Event) => {
    const step = (e as CustomEvent<PredictiveBack>).detail;
    if (step && typeof step.phase === "string" && typeof step.progress === "number") handler(step);
  };
  scope.addEventListener(PREDICTIVE_BACK_EVENT, listener);
  if (predictiveHearers++ === 0) actions.postMessage("predictive-back:on");
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    scope.removeEventListener(PREDICTIVE_BACK_EVENT, listener);
    if (--predictiveHearers === 0) actions.postMessage?.("predictive-back:off");
  };
}

/**
 * Android's gesture to the drag while it has one (the page follows the finger, `progress` across `width`), else to
 * the handler once it goes back. Android has already decided whether it goes back, so `back` always does and
 * `cancel` never does; a `back` without a `begin` (a button) is the handler's.
 */
export function followPredictive(
  handler: () => void,
  drag?: () => BackDrag | undefined,
  width: () => number = () => globalThis.innerWidth,
): (step: PredictiveBack) => void {
  let taken: BackDrag | undefined;
  let w = 0;
  return (step) => {
    if (step.phase === "begin") {
      w = width();
      const d = drag?.();
      taken = d?.begin() ? d : undefined;
      taken?.move(step.progress * w, w);
    } else if (step.phase === "move") {
      taken?.move(step.progress * w, w);
    } else {
      const was = taken;
      taken = undefined;
      if (was) was.end(step.phase === "back");
      else if (step.phase === "back") handler();
    }
  };
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

type ImmersiveBridge = { polarActions?: Actions; polarDevice?: { immersive?: (on: boolean) => void; keepAwake?: (on: boolean) => void } };

/**
 * Keep the screen on while a video plays, and let it dim and lock again when it pauses or the player closes, as
 * other video apps do: Android through the page's bridge (MainActivity.kt), iOS's idle timer through the shell
 * (ios/system_bars.m). Elsewhere it does nothing.
 */
export function keepScreenOn(on: boolean, scope: ImmersiveBridge = globalThis as ImmersiveBridge): void {
  if (os === "ios" && inShell) {
    void call<void>("player_keep_awake", { on }).catch(() => {});
    return;
  }
  try {
    if (typeof scope.polarActions?.postMessage === "function") scope.polarActions.postMessage(on ? "awake:on" : "awake:off");
    else scope.polarDevice?.keepAwake?.(on);
  } catch {
    // An older shell without the call: the screen locks on its own timer, as before.
  }
}

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
