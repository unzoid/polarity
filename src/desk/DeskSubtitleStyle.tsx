import type { ReactNode } from "react";
import { Dropdown } from "../components/Dropdown";
import { ChevronLeft, ChevronRight, Reset } from "../components/icons";
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
  Swatches,
  TEXT_COLORS,
} from "../components/player/SubtitleSettings";
import { Switch } from "../components/ui/Switch";
import { setPrefs, usePrefs, type DrcProfile } from "../lib/settings";
import type { SubtitleStyle } from "../lib/types";
import { IconCheck } from "./DeskPlayerIcons";

/**
 * Subtitle Style in the desk player's Audio & Subtitles sheet, drawn in the sheet's own language: columns with a
 * heading each, plain rows of a label and its control, and the fixed choices (outline, background) as the same
 * check-mark lists as the track lists beside them. No wells or tiles; the subtitles on the picture are the preview.
 * The columns wrap to fit the window (deskPlayer.css, .dk-pl-style).
 */
export function DeskSubtitleStyle({
  style: saved,
  onChange,
  delay,
  onDelay,
  onStepLine,
  second,
  canPosition,
}: {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  delay?: number;
  onDelay?: (seconds: number) => void;
  onStepLine?: (by: 1 | -1) => void;
  second?: { on: boolean; onChange: (on: boolean) => void };
  canPosition: boolean;
}) {
  const style = complete(saved);
  const fromSubtitles = keepsReleaseFont(saved);
  const timing = canPosition && onDelay && delay !== undefined;
  const isDefault = isDefaultStyle(saved) && !delay;

  return (
    <div className="dk-pl-style">
      <div className="dk-pl-style-cols">
        {(timing || onStepLine || second) && (
          <Section title="Timing">
            {timing && (
              <Row label="Delay" detail={delay === 0 ? "In sync" : delay! > 0 ? "Subtitles later" : "Subtitles earlier"}>
                <Stepper
                  value={delay!}
                  step={0.1}
                  min={-30}
                  max={30}
                  format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
                  onChange={onDelay!}
                  label="Delay"
                />
              </Row>
            )}
            {onStepLine && (
              <Row label="Match a line">
                <div className="dk-pl-style-pair" role="group" aria-label="Match a line">
                  <button type="button" aria-label="Previous line" title="Previous line" onClick={() => onStepLine(-1)}>
                    <ChevronLeft size={16} strokeWidth={2.4} />
                  </button>
                  <button type="button" aria-label="Next line" title="Next line" onClick={() => onStepLine(1)}>
                    <ChevronRight size={16} strokeWidth={2.4} />
                  </button>
                </div>
              </Row>
            )}
            {second && (
              <label className="dk-pl-style-row">
                <RowText label="Second subtitle" />
                <Switch checked={second.on} onChange={second.onChange} />
              </label>
            )}
          </Section>
        )}

        <Section title="Text">
          <Row label="Font">
            <Dropdown
              label="Subtitle font"
              value={fromSubtitles ? FROM_SUBTITLES : style.font}
              options={FONTS}
              onChange={(font) => onChange(font === FROM_SUBTITLES ? { font: DEFAULT_FONT, fontFromSubtitles: true } : { font, fontFromSubtitles: false })}
            />
          </Row>
          <Row label="Size">
            <Stepper value={style.size} step={10} min={50} max={200} format={(v) => `${v}%`} onChange={(size) => onChange({ size })} label="Size" />
          </Row>
          {canPosition && (
            <Row label="Position">
              <Stepper value={style.raise} step={2} min={0} max={40} format={(v) => (v === 0 ? "Default" : `+${v}%`)} onChange={(raise) => onChange({ raise })} label="Position" />
            </Row>
          )}
          <Row label="Opacity">
            <Stepper value={style.opacity} step={10} min={20} max={100} format={(v) => `${v}%`} onChange={(opacity) => onChange({ opacity })} label="Opacity" />
          </Row>
          <Row label="Color">
            <Swatches value={style.color} options={TEXT_COLORS} onChange={(color) => onChange({ color })} label="Text color" />
          </Row>
        </Section>

        <Section title="Outline">
          <Choices label="Outline" value={style.outline} options={OUTLINES} onChange={(outline) => onChange({ outline })} />
          {style.outline !== "none" && (
            <Row label="Color">
              <Swatches value={style.outlineColor} options={OUTLINE_COLORS} onChange={(outlineColor) => onChange({ outlineColor })} label="Outline color" />
            </Row>
          )}
          {/* Background shares the Outline column: three columns fit a small window, where a fourth would wrap below the fold. */}
          <h3 className="dk-pl-style-title" data-follows>
            Background
          </h3>
          <Choices label="Background" value={style.background} options={BACKGROUNDS} onChange={(background) => onChange({ background })} />
        </Section>
      </div>

      <button
        type="button"
        className="dk-pl-style-reset"
        disabled={isDefault}
        onClick={() => {
          onChange(DEFAULT_SUBTITLE_STYLE);
          onDelay?.(0);
        }}
      >
        <Reset size={15} strokeWidth={2.25} /> Reset to default
      </button>
    </div>
  );
}

const DRC_PROFILES: { value: DrcProfile; label: string }[] = [
  { value: "pure", label: "Pure cinema" },
  { value: "livingRoom", label: "Living room" },
  { value: "lateNight", label: "Late night" },
];

/**
 * The Audio column's sound settings, in the same language as Subtitle Style beside it: headed columns of plain
 * rows, switches for the on/off options and a check-mark list for the dynamic range. The delay is this source's
 * (lib/playback/trackMemory.ts); the rest are this device's, as in Settings → Subtitles & Audio.
 */
export function DeskSoundSettings({ delay, onDelay }: { delay: number; onDelay: (seconds: number) => void }) {
  const { dialogueBoost, volumeLeveling, drcProfile } = usePrefs();
  return (
    <div className="dk-pl-style">
      <div className="dk-pl-style-cols">
        <Section title="Sound">
          <Row label="Delay" detail={delay === 0 ? "In sync" : delay > 0 ? "Sound later" : "Sound earlier"}>
            <Stepper
              value={delay}
              step={0.05}
              min={-10}
              max={10}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}s`}
              onChange={onDelay}
              label="Audio delay"
            />
          </Row>
          <label className="dk-pl-style-row">
            <RowText label="Boost dialogue" />
            <Switch checked={dialogueBoost} onChange={(on) => setPrefs({ dialogueBoost: on })} />
          </label>
          <label className="dk-pl-style-row">
            <RowText label="Even out volume" />
            <Switch checked={volumeLeveling} onChange={(on) => setPrefs({ volumeLeveling: on })} />
          </label>
        </Section>
        <Section title="Dynamic range">
          <Choices label="Dynamic range" value={drcProfile} options={DRC_PROFILES} onChange={(v) => setPrefs({ drcProfile: v })} />
        </Section>
      </div>
      <button type="button" className="dk-pl-style-reset" disabled={delay === 0} onClick={() => onDelay(0)}>
        <Reset size={15} strokeWidth={2.25} /> Reset delay
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dk-pl-style-col" aria-label={title}>
      <h3 className="dk-pl-style-title">{title}</h3>
      {children}
    </section>
  );
}

function RowText({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="dk-pl-style-text">
      <span className="dk-pl-style-label">{label}</span>
      {detail && <span className="dk-pl-style-detail">{detail}</span>}
    </span>
  );
}

function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="dk-pl-style-row">
      <RowText label={label} detail={detail} />
      {children}
    </div>
  );
}

/** A fixed set of choices as the track lists draw them: a check beside the one in use. */
function Choices<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={selected} className="dk-pl-track-row" onClick={() => onChange(o.value)}>
            <span className="dk-pl-track-check" aria-hidden>
              {selected && <IconCheck size={18} stroke={2.2} />}
            </span>
            <span className="dk-pl-track-text">
              <span className="dk-pl-track-label">{o.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
