import { useViewingLimit } from "../../lib/catalog/viewingLimit";
import { choicesOf, settingDef } from "../../lib/settings/catalog";
import { RowText } from "../settings/rows";

export const SET_IN_PROFILE = "Set in the profile";

/** How the limit reads when it's the profile's own (its edit sheet sets it): the value, with no control. */
export function limitLabel(limit: number | null): string {
  const def = settingDef("viewingLimit");
  const choices = def.control?.kind === "choice" ? choicesOf(def.control, limit ?? 0) : [];
  return choices.find((c) => c.value === (limit ?? 0))?.label ?? String(limit);
}

/**
 * Settings → Browsing → Family while the profile in use has its limit on its row (a restricted profile): the
 * Browsing rows' titles with the values, read-only.
 */
export function LimitFromProfile() {
  const { limit, hideUnrated } = useViewingLimit();
  return (
    <>
      <div className="settings-row" data-setting="viewingLimit">
        <RowText title={settingDef("viewingLimit").title} caption={SET_IN_PROFILE} />
        <span className="settings-row-value">{limitLabel(limit)}</span>
      </div>
      <div className="settings-row" data-setting="viewingHideUnrated">
        <RowText title={settingDef("viewingHideUnrated").title} caption={SET_IN_PROFILE} />
        <span className="settings-row-value">{hideUnrated ? "On" : "Off"}</span>
      </div>
    </>
  );
}
