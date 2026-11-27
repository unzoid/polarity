import { GlassSlider } from "@glass-sdk/liquid-glass/react";
import type { SliderTrackProps } from "../SliderField";

/**
 * The desktop Settings window's slider: Liquid Glass's (`@glass-sdk/liquid-glass`, MIT), whose thumb lifts into a
 * refracting lens while held, as the window's switches do (GlassSwitch.tsx). It draws inside the window's
 * `GlassScene` (SettingsOverlay.tsx); without its engine (or WebGL2) it's the same slider without the lens. The
 * filled part of the track is the accent colour; the number beside it is still SliderField's.
 */
export function SettingsGlassSlider({ label, value, min, max, step, onValueChange, onValueCommit }: SliderTrackProps) {
  return (
    <GlassSlider
      className="slider-field-slider"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      tint="var(--accent)"
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
    />
  );
}
