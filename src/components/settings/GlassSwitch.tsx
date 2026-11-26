import { GlassSwitch } from "@glass-sdk/liquid-glass/react";
import type { SwitchProps } from "../ui/Switch";

/**
 * The desktop Settings window's switch: Liquid Glass's (`@glass-sdk/liquid-glass`, MIT), whose thumb lifts
 * into a real refracting lens while held, springs across and can be dragged. It draws inside the window's
 * `GlassScene` (SettingsOverlay.tsx); until that scene's engine has loaded, or where WebGL2 isn't to be had,
 * it's the same switch without the lens, and still works. Takes what `Switch` takes; the track is the
 * accent colour while on. A `<label>` around it names it, as it does the checkbox.
 */
export function SettingsGlassSwitch({ checked, onChange, disabled, id, title, tabIndex, autoFocus, ...rest }: SwitchProps) {
  return (
    <GlassSwitch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      tint="var(--accent)"
      id={id}
      title={title}
      tabIndex={tabIndex}
      autoFocus={autoFocus}
      aria-label={rest["aria-label"]}
      aria-labelledby={rest["aria-labelledby"]}
      aria-describedby={rest["aria-describedby"]}
    />
  );
}
