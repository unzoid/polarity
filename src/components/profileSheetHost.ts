import { useFormFactor } from "../lib/ui";

/**
 * Whether the profile sheet (ProfileMenu.tsx, a phone's) shows Friends and "Join a Watch Party" itself, as views
 * inside it, rather than their own dialogs: on every phone, iPhones too (only an iPad's profile menu is the system's).
 */
export function useProfileSheetHosts() {
  return useFormFactor().form === "phone";
}
