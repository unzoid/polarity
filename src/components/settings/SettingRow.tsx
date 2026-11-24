import { useState } from "react";
import { choicesOf, shownNumber, storedNumber, useSetting, type Value } from "../../lib/settings/catalog";
import { useFormFactor } from "../../lib/ui";
import { Dropdown } from "../Dropdown";
import { FamilyPickerTray, MoreDots } from "./FamilyTray";
import { NumberRow, PickRow, RowText, ToggleRow } from "./rows";

/**
 * A desktop row drawn from the settings schema (lib/settings/schema.ts): a switch, a dropdown
 * or a slider, with the schema's title, caption, choices and range. `caption` overrides the
 * schema's when it depends on the moment ("This screen is 4K…"); `status` (a switch's) adds what the
 * setting does right now on a line of its own; `onChanged` runs after a change (a sound, clearing a list);
 * `omit` leaves out choices this device can't use (still shown while it's the stored one).
 */
export function SettingRow({
  id,
  caption,
  status,
  disabled,
  onChanged,
  omit,
}: {
  id: string;
  caption?: string;
  status?: string | null;
  disabled?: boolean;
  onChanged?: (v: Value) => void;
  omit?: Value[];
}) {
  const { def, value, set } = useSetting(id);
  const phone = useFormFactor().form === "phone";
  const [trayOpen, setTrayOpen] = useState(false);
  if (value === undefined || !def.control) return null;
  const change = (v: Value) => {
    set(v);
    onChanged?.(v);
  };
  const shared = { setting: def.id, title: def.title, caption: caption ?? def.caption };
  const control = def.control;

  switch (control.kind) {
    case "toggle":
      return <ToggleRow {...shared} status={status} checked={!!value} disabled={disabled} onChange={change} />;
    case "number":
      return (
        <NumberRow
          {...shared}
          value={shownNumber(control, Number(value))}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          zero={control.zero}
          onChange={(n) => change(storedNumber(control, n))}
        />
      );
    case "choice": {
      // Dropdown values are strings: each choice goes by its index.
      const choices = choicesOf(control, value).filter((c) => c.value === value || !omit?.includes(c.value));
      if (phone) {
        const current = choices.find((c) => c.value === value)?.label ?? String(value);
        return (
          <>
            <button
              type="button"
              className="settings-row settings-row-button ft-choice-row"
              data-setting={def.id}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={trayOpen}
              onClick={() => setTrayOpen(true)}
            >
              <RowText title={def.title} caption={caption ?? def.caption} />
              <span className="ft-choice-right">
                <span className="ft-choice-value">{current}</span>
                <MoreDots size={16} className="ft-choice-dots" />
              </span>
            </button>
            <FamilyPickerTray
              open={trayOpen}
              onClose={() => setTrayOpen(false)}
              title={def.controlLabel ?? def.title}
              value={value}
              options={choices}
              onPick={change}
            />
          </>
        );
      }
      return (
        <PickRow {...shared}>
          <Dropdown
            label={def.controlLabel ?? def.title}
            value={String(choices.findIndex((c) => c.value === value))}
            onChange={(i) => change(choices[Number(i)].value)}
            options={choices.map((c, i) => ({ value: String(i), label: c.label }))}
          />
        </PickRow>
      );
    }
  }
}
