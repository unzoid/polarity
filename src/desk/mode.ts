import { usePrefs } from "../lib/settings";
import { useFormFactor } from "../lib/ui";
import { useTvMode } from "../tv/tvMode";

/** Whether this screen gets the desk app (src/desk): a computer or tablet, not in TV mode, unless Settings asks for the classic layout. */
export function useDeskUi() {
  const { form } = useFormFactor();
  const tv = useTvMode();
  const { classicDesktop } = usePrefs();
  return form !== "phone" && !tv && !classicDesktop;
}
