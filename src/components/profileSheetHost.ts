import { nativeDialogsAvailable } from "../lib/platform";
import { useFormFactor } from "../lib/ui";

/**
 * Whether the profile menu (ProfileMenu.tsx: a popover, or a phone's sheet) shows Friends and "Join a Watch Party"
 * itself, as views inside it, rather than their own dialogs: everywhere but an iPad, where the profile menu is the
 * system's (a phone, iPhones too, has the sheet). TV mode has its own (no profile menu, nor these dialogs).
 */
export function useProfileMenuHosts() {
  const phone = useFormFactor().form === "phone";
  return phone || !nativeDialogsAvailable;
}
