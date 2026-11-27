import { createContext, useContext, type ComponentType, type InputHTMLAttributes } from "react";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "className" | "checked" | "onChange">;

export type SwitchProps = Native & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * Another switch to draw in place of the checkbox, for every `Switch` below it: the desktop Settings
 * window's glass one (settings/GlassSwitch.tsx). Given by context so its library loads with Settings, not
 * with every screen that has a switch.
 */
const SwitchOverride = createContext<ComponentType<SwitchProps> | null>(null);
export const SwitchProvider = SwitchOverride.Provider;

/**
 * An on/off switch (docs/ui-components.md U17): a native checkbox with `role="switch"`, so it
 * works with the keyboard and a label around it names it. Styling in styles/ui/switch.css.
 */
export function Switch(props: SwitchProps) {
  const Override = useContext(SwitchOverride);
  if (Override) return <Override {...props} />;
  const { checked, onChange, ...rest } = props;
  return <input type="checkbox" className="switch" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />;
}
