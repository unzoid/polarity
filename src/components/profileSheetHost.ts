import { nativeDialogsAvailable } from "../lib/platform";

/**
 * Whether the profile menu (ProfileMenu.tsx: a popover, or a phone's sheet) shows Friends and "Join a Watch Party"
 * itself, as views inside it, rather than their own dialogs: everywhere but iOS, where the profile menu is the
 * system's. TV mode has its own (no profile menu, nor these dialogs).
 */
export function useProfileMenuHosts() {
  return !nativeDialogsAvailable;
}
