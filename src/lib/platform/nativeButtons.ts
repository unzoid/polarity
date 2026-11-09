import { call, inShell, on, type Unlisten } from "./bridge";
import { os } from "./device";

/**
 * iOS's own buttons for a few of the web app's (src-tauri/src/ios/buttons.m): system buttons laid over the web app's
 * where they stand, Liquid Glass on iOS 26 and later, following the page's scrolling on their own. The web app says
 * where its buttons are, what they say and whether they show; a tap comes back through onNativeButton with the
 * button's id. Android and the desktop show the web app's own buttons.
 */
export const nativeButtonsAvailable = os === "ios" && inShell;

export type NativeButton = {
  id: string;
  title: string;
  /** An SF Symbol's name ("play.fill"). */
  symbol: string;
  /** What VoiceOver reads, when it isn't the title. */
  label: string;
  /** The screen's main action: the prominent kind. */
  prominent: boolean;
  /** The web app's button, in CSS pixels of the viewport. */
  rect: { x: number; y: number; width: number; height: number };
};

export type NativeButtonsState = {
  shown: boolean;
  /** Nothing is drawn above this line (CSS pixels of the viewport): the web app's top bar. */
  clip_top: number;
  items: NativeButton[];
};

export function setNativeButtons(buttons: NativeButtonsState): Promise<void> {
  return call("native_buttons", { buttons });
}

/** Hear the buttons (the id of the one tapped) until the returned function is called. */
export function onNativeButton(handler: (id: string) => void): Promise<Unlisten> {
  return on<string>("native://button", handler);
}
