import { useState } from "react";
import {
  BACKGROUNDS,
  complete,
  DEFAULT_FONT,
  DEFAULT_SUBTITLE_STYLE,
  FONTS,
  FROM_SUBTITLES,
  isDefaultStyle,
  keepsReleaseFont,
  OUTLINE_COLORS,
  OUTLINES,
  Stepper,
  subtitleCueVars,
  Swatches,
  TEXT_COLORS,
} from "../player/SubtitleSettings";
import { Reset } from "../icons";
import type { SubtitleStyle } from "../../lib/types";
import { FamilyPickerTray, MoreDots } from "./FamilyTray";
import { Card, RowText } from "./rows";

type Tray = "font" | "outline" | "background";

/**
 * Settings → Subtitles → Subtitle Style on a phone, in the phone settings' own rows: the sample on top, then a row
 * per setting. Font, outline and background open a picker tray as other choices do; size, position and opacity
 * step in place; the colours stay swatches.
 */
export function PhoneSubtitleStyle({
  style: saved,
  onChange,
  canPosition,
}: {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  canPosition: boolean;
}) {
  const [tray, setTray] = useState<Tray | null>(null);
  // Styles saved before a setting existed lack it.
  const style = complete(saved);
  const font = keepsReleaseFont(saved) ? FROM_SUBTITLES : style.font;
  const labelOf = <V,>(options: { value: V; label: string }[], value: V) => options.find((o) => o.value === value)?.label ?? String(value);
  const choice = (id: Tray, title: string, value: string) => (
    <button type="button" className="settings-row settings-row-button ft-choice-row" aria-haspopup="dialog" aria-expanded={tray === id} onClick={() => setTray(id)}>
      <RowText title={title} />
      <span className="ft-choice-right">
        <span className="ft-choice-value">{value}</span>
        <MoreDots size={16} className="ft-choice-dots" />
      </span>
    </button>
  );

  return (
    <>
      <div className="settings-sub-sample" data-setting="subtitleStyle" style={subtitleCueVars(saved)} aria-hidden>
        <span>This is how your subtitles will look.</span>
      </div>
      <Card title="Text">
        {choice("font", "Font", labelOf(FONTS, font))}
        <div className="settings-row ft-inline-row">
          <RowText title="Size" />
          <Stepper value={style.size} step={10} min={50} max={200} format={(v) => `${v}%`} onChange={(size) => onChange({ size })} label="Size" />
        </div>
        {canPosition && (
          <div className="settings-row ft-inline-row">
            <RowText title="Position" />
            <Stepper value={style.raise} step={2} min={0} max={40} format={(v) => (v === 0 ? "Default" : `+${v}%`)} onChange={(raise) => onChange({ raise })} label="Position" />
          </div>
        )}
        <div className="settings-row ft-inline-row">
          <RowText title="Opacity" />
          <Stepper value={style.opacity} step={10} min={20} max={100} format={(v) => `${v}%`} onChange={(opacity) => onChange({ opacity })} label="Opacity" />
        </div>
        <div className="settings-row ft-inline-row">
          <RowText title="Color" />
          <Swatches value={style.color} options={TEXT_COLORS} onChange={(color) => onChange({ color })} label="Color" />
        </div>
      </Card>
      <Card title="Edge">
        {choice("outline", "Outline", labelOf(OUTLINES, style.outline))}
        {style.outline !== "none" && (
          <div className="settings-row ft-inline-row">
            <RowText title="Outline color" />
            <Swatches value={style.outlineColor} options={OUTLINE_COLORS} onChange={(outlineColor) => onChange({ outlineColor })} label="Outline color" />
          </div>
        )}
        {choice("background", "Background", labelOf(BACKGROUNDS, style.background))}
      </Card>
      <Card>
        <button type="button" className="settings-row settings-row-button ft-reset-row" disabled={isDefaultStyle(saved)} onClick={() => onChange(DEFAULT_SUBTITLE_STYLE)}>
          <Reset size={20} className="settings-row-icon" />
          <RowText title="Reset to default" />
        </button>
      </Card>

      <FamilyPickerTray
        open={tray === "font"}
        onClose={() => setTray(null)}
        title="Font"
        value={font}
        options={FONTS}
        onPick={(f) => onChange(f === FROM_SUBTITLES ? { font: DEFAULT_FONT, fontFromSubtitles: true } : { font: f, fontFromSubtitles: false })}
      />
      <FamilyPickerTray open={tray === "outline"} onClose={() => setTray(null)} title="Outline" value={style.outline} options={OUTLINES} onPick={(outline) => onChange({ outline })} />
      <FamilyPickerTray
        open={tray === "background"}
        onClose={() => setTray(null)}
        title="Background"
        value={style.background}
        options={BACKGROUNDS}
        onPick={(background) => onChange({ background })}
      />
    </>
  );
}
