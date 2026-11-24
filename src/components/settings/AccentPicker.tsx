import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useSettings, useUpdateSettings } from "../../lib/net";
import {
  ACCENT_THEME,
  ACCENTS,
  accentName,
  resolveAccent,
  schemeStyle,
  type ColorScheme,
  type ColorSchemeSetting,
} from "../../lib/theme";
import { Brightness, Desktop, Moon, PaintBrush } from "../icons";
import { Swatches } from "../player/SubtitleSettings";
import { useFormFactor } from "../../lib/ui";
import { useAppleCorners } from "../../lib/ui/cornerSmoothing";
import { FamilyTray, MoreDots } from "./FamilyTray";
import { Card, PickRow, RowText } from "./rows";

const SCHEMES: { id: ColorSchemeSetting; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const SCHEME_ICONS: Record<ColorSchemeSetting, typeof Moon> = { system: Desktop, light: Brightness, dark: Moon };

/**
 * Settings → Appearance: the colour scheme (System, Light, Dark) and the accent colour. On a phone each is
 * a row opening a tray; elsewhere the schemes are small pictures of a window and the accents a row of swatches.
 */
export function AccentPicker() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const phone = useFormFactor().form === "phone";
  const [tray, setTray] = useState<"scheme" | "accent" | null>(null);
  if (!data) return null;

  const accent = resolveAccent(data);
  const pickAccent = (hex: string) => {
    const value = hex.toUpperCase();
    if (value !== accent || data.theme !== ACCENT_THEME) update.mutate({ theme: ACCENT_THEME, accentColor: value });
  };
  const schemeSetting = data.colorScheme ?? "dark";
  const pickScheme = (id: ColorSchemeSetting) => id !== schemeSetting && update.mutate({ colorScheme: id });

  if (phone) {
    return (
      <>
        <Card title="Colours">
          <button
            type="button"
            className="settings-row settings-row-button ft-choice-row"
            data-setting="colorScheme"
            aria-haspopup="dialog"
            aria-expanded={tray === "scheme"}
            onClick={() => setTray("scheme")}
          >
            <Moon className="settings-row-icon" size={20} />
            <RowText title="Colour scheme" />
            <span className="ft-choice-right">
              <span className="ft-choice-value">{SCHEMES.find((s) => s.id === schemeSetting)?.label ?? "Dark"}</span>
              <MoreDots size={16} className="ft-choice-dots" />
            </span>
          </button>
          <button
            type="button"
            className="settings-row settings-row-button ft-choice-row"
            data-setting="accentColor"
            aria-haspopup="dialog"
            aria-expanded={tray === "accent"}
            onClick={() => setTray("accent")}
          >
            <PaintBrush className="settings-row-icon" size={20} />
            <RowText title="Accent colour" />
            <span className="ft-choice-right">
              <span className="ft-choice-value">
                <span className="ft-swatch-dot" style={{ background: accent }} aria-hidden />
                {accentName(accent)}
              </span>
              <MoreDots size={16} className="ft-choice-dots" />
            </span>
          </button>
        </Card>

        <FamilyTray open={tray === "scheme"} onClose={() => setTray(null)} title="Colour scheme" stepKey="scheme">
          <div className="ft-scheme-tiles" role="radiogroup" aria-label="Colour scheme">
            {SCHEMES.map((s) => (
              <SmoothSchemeTile key={s.id} selected={s.id === schemeSetting} label={s.label} icon={SCHEME_ICONS[s.id]} onClick={() => pickScheme(s.id)} />
            ))}
          </div>
        </FamilyTray>

        <FamilyTray open={tray === "accent"} onClose={() => setTray(null)} title="Accent colour" stepKey="accent">
          <AccentGrid value={accent} onPick={pickAccent} />
          <div className="ft-actions ft-picker-foot">
            <button type="button" className="ft-pill ft-pill-cta" onClick={() => setTray(null)}>
              Done
            </button>
          </div>
        </FamilyTray>
      </>
    );
  }

  return (
    <>
      <section className="settings-group theme-picker" data-setting="colorScheme">
        <h2 className="settings-group-title">Colour scheme</h2>
        <div className="settings-card">
          <TileGrid
            label="Colour scheme"
            className="theme-grid scheme-grid"
            items={SCHEMES}
            chosen={SCHEMES.findIndex((s) => s.id === schemeSetting)}
            onChoose={(s) => pickScheme(s.id)}
            render={(s) => (
              <>
                {s.id === "system" ? (
                  <span className="scheme-split">
                    <SchemeThumb accent={accent} scheme="light" />
                    <SchemeThumb accent={accent} scheme="dark" />
                  </span>
                ) : (
                  <SchemeThumb accent={accent} scheme={s.id} />
                )}
                <span className="theme-tile-name">{s.label}</span>
              </>
            )}
          />
        </div>
      </section>
      <Card>
        <PickRow setting="accentColor" title="Accent colour">
          <Swatches value={accent} options={[...ACCENTS]} onChange={pickAccent} label="Accent colour" />
        </PickRow>
      </Card>
    </>
  );
}

/** The phone tray's accents: a dot and its name each, then any colour through the system's picker. */
function AccentGrid({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const custom = !ACCENTS.some((a) => a.value === value);
  // The native picker reports every drag step; save once it settles.
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="ft-accent-grid" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map((a) => (
        <button
          key={a.value}
          type="button"
          role="radio"
          aria-checked={a.value === value}
          className="ft-accent-tile"
          style={{ "--swatch": a.value } as CSSProperties}
          onClick={() => onPick(a.value)}
        >
          <span className="ft-accent-dot" aria-hidden />
          {a.label}
        </button>
      ))}
      <label className="ft-accent-tile ft-accent-custom" role="radio" aria-checked={custom} data-custom={custom} style={custom ? ({ "--swatch": value } as CSSProperties) : undefined}>
        <span className="ft-accent-dot" aria-hidden />
        Custom
        <input
          type="color"
          aria-label="Custom accent colour"
          value={custom ? value.toLowerCase() : "#ff7a59"}
          onChange={(e) => {
            const hex = e.target.value;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => onPick(hex), 120);
          }}
        />
      </label>
    </div>
  );
}

function SmoothSchemeTile({ selected, label, icon: Icon, onClick }: { selected: boolean; label: string; icon: typeof Moon; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // Apple 60% squircle tile, concentric with the tray's corners and padding.
  const corners = useAppleCorners(ref, 28, 60);
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      className={`ft-scheme-tile${selected ? " is-selected" : ""}`}
      style={corners.clipPath ? { clipPath: corners.clipPath, borderRadius: 0 } : undefined}
      onClick={onClick}
    >
      <Icon size={22} />
      <span>{label}</span>
      {corners.active && (
        <svg className="ft-smooth-stroke" width={corners.width} height={corners.height} viewBox={`0 0 ${corners.width} ${corners.height}`} aria-hidden>
          <path
            d={corners.strokePath(0.85)}
            fill="none"
            stroke={selected ? "var(--ft-fg)" : "var(--ft-tile-rim)"}
            strokeWidth={selected ? 1.7 : 1.25}
          />
        </svg>
      )}
    </button>
  );
}

/** A radio group of tiles: one tab stop, arrows move through the grid (by rows too) and choose as they go. */
function TileGrid<T>({
  label,
  className,
  items,
  chosen,
  onChoose,
  render,
}: {
  label: string;
  className: string;
  items: T[];
  chosen: number;
  onChoose: (item: T) => void;
  render: (item: T) => ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const at = Math.max(0, chosen);

  const onKeyDown = (e: KeyboardEvent) => {
    const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 1;
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + columns, ArrowUp: at - columns, Home: 0, End: items.length - 1 };
    if (!(e.key in moves)) return;
    const next = Math.min(items.length - 1, Math.max(0, moves[e.key]));
    e.preventDefault();
    e.stopPropagation();
    onChoose(items[next]);
    grid.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };

  return (
    <div className={className} role="radiogroup" aria-label={label} ref={grid} onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={i === chosen}
          tabIndex={i === at ? 0 : -1}
          className="theme-tile"
          onClick={() => onChoose(item)}
        >
          {render(item)}
        </button>
      ))}
    </div>
  );
}

/** A small Settings window in a scheme's colours: sidebar, a page with two lines and a pill, a field with the accent. */
function SchemeThumb({ accent, scheme }: { accent: string; scheme: ColorScheme }) {
  return (
    <span className={`theme-thumb themed scheme-${scheme}`} style={schemeStyle(accent, scheme) as CSSProperties} aria-hidden>
      <span className="theme-thumb-side" />
      <span className="theme-thumb-page">
        <span className="theme-thumb-line" />
        <span className="theme-thumb-line theme-thumb-line-short" />
        <span className="theme-thumb-pill" />
        <span className="theme-thumb-field" />
      </span>
    </span>
  );
}
