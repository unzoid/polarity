import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useSettings, useUpdateSettings } from "../../lib/net";
import {
  BLACK_BASE,
  DARK_BASE,
  MAX_CUSTOM_THEMES,
  MAX_THEME_NAME,
  THEME_ACCENTS,
  copyName,
  customThemeId,
  newCustomThemeId,
  resolveScheme,
  resolveTheme,
  themeList,
  themeStyle,
  useSystemPrefersLight,
  type ColorScheme,
  type ColorSchemeSetting,
  type Theme,
} from "../../lib/theme";
import type { CustomTheme } from "../../lib/types";
import { useConfirmDelete } from "../ConfirmDeleteButton";
import { Edit, Plus } from "../icons";
import { Segmented } from "../Segmented";
import { Button } from "../ui/Button";

/**
 * Settings → Appearance: the colour scheme (System, Light, Dark) and the theme. Each choice is a small
 * picture of a window in its colours, the chosen one ringed in its accent. Create theme starts a copy of
 * the chosen theme; the user's own can be edited and deleted. Styling in styles/screens.css (`.theme-*`).
 */
export function ThemePicker() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefersLight = useSystemPrefersLight();
  const [dialog, setDialog] = useState<{ editing: Theme | null } | null>(null);
  if (!data) return null;

  const themes = themeList(data);
  const chosen = resolveTheme(data);
  const scheme = resolveScheme(data.colorScheme, prefersLight);
  const mine = data.customThemes ?? [];
  const full = mine.length >= MAX_CUSTOM_THEMES;

  const save = (draft: Draft, editing: Theme | null) => {
    const values = { name: draft.name.trim().slice(0, MAX_THEME_NAME), accent: draft.accent, base: draft.base, tint: draft.tint };
    if (editing) {
      const id = editing.id.slice("custom:".length);
      update.mutate({ customThemes: mine.map((t) => (t.id === id ? { ...t, ...values } : t)) });
    } else {
      const made: CustomTheme = { id: newCustomThemeId(mine), ...values };
      update.mutate({ customThemes: [...mine, made], theme: customThemeId(made.id) });
    }
    setDialog(null);
  };

  const remove = (t: Theme) => {
    const id = t.id.slice("custom:".length);
    update.mutate({ customThemes: mine.filter((m) => m.id !== id), ...(data.theme === t.id ? { theme: "polar" } : {}) });
    setDialog(null);
  };

  const schemes: { id: ColorSchemeSetting; label: string }[] = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  const schemeSetting = data.colorScheme ?? "dark";

  return (
    <>
      <section className="settings-group theme-picker" data-setting="colorScheme">
        <h2 className="settings-group-title">Colour scheme</h2>
        <div className="settings-card">
          <TileGrid
            label="Colour scheme"
            className="theme-grid scheme-grid"
            items={schemes}
            chosen={schemes.findIndex((s) => s.id === schemeSetting)}
            onChoose={(s) => s.id !== schemeSetting && update.mutate({ colorScheme: s.id })}
            render={(s) => (
              <>
                {s.id === "system" ? (
                  <span className="scheme-split">
                    <ThemeThumb theme={chosen} scheme="light" />
                    <ThemeThumb theme={chosen} scheme="dark" />
                  </span>
                ) : (
                  <ThemeThumb theme={chosen} scheme={s.id} />
                )}
                <span className="theme-tile-name">{s.label}</span>
              </>
            )}
          />
        </div>
      </section>

      <section className="settings-group theme-picker" data-setting="theme">
        <div className="theme-picker-head">
          <h2 className="settings-group-title">Theme</h2>
          <div className="theme-picker-actions">
            {chosen.custom && (
              <Button onClick={() => setDialog({ editing: chosen })}>
                <Edit size={16} />
                Edit
              </Button>
            )}
            <Button
              disabled={full}
              title={full ? `Up to ${MAX_CUSTOM_THEMES} themes of your own` : undefined}
              onClick={() => setDialog({ editing: null })}
            >
              <Plus size={16} />
              Create theme
            </Button>
          </div>
        </div>
        <div className="settings-card">
          <TileGrid
            label="Theme"
            className="theme-grid"
            items={themes}
            chosen={themes.findIndex((t) => t.id === chosen.id)}
            onChoose={(t) => t.id !== data.theme && update.mutate({ theme: t.id })}
            render={(t) => (
              <>
                <ThemeThumb theme={t} scheme={scheme} />
                <span className="theme-tile-name">{t.name}</span>
              </>
            )}
          />
        </div>
        <ThemeDialog
          open={!!dialog}
          editing={dialog?.editing ?? null}
          from={chosen}
          themes={themes}
          scheme={scheme}
          onClose={() => setDialog(null)}
          onSave={save}
          onDelete={remove}
        />
      </section>
    </>
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

/** A small Settings window in a theme's colours: sidebar, a page with two lines and a pill, a field with the accent. */
function ThemeThumb({ theme, scheme }: { theme: Pick<Theme, "accent" | "base" | "tint">; scheme: ColorScheme }) {
  return (
    <span className={`theme-thumb themed scheme-${scheme}`} style={themeStyle(theme, scheme) as CSSProperties} aria-hidden>
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

type Draft = { name: string; accent: string; base: string; tint: number };

const TINTS = [
  { id: 0, label: "None" },
  { id: 3.5, label: "Subtle" },
  { id: 7, label: "Rich" },
];
const nearestTint = (v: number) => TINTS.reduce((a, b) => (Math.abs(b.id - v) < Math.abs(a.id - v) ? b : a)).id;

function draftOf(from: Theme, editing: Theme | null, themes: Theme[]): Draft {
  const t = editing ?? from;
  return { name: editing ? editing.name : copyName(from.name, themes), accent: t.accent, base: t.base, tint: t.tint };
}

/**
 * Create theme (a copy of `from`) or edit one of the user's. The dialog is drawn in the draft's colours,
 * so every change shows at once: the preview up top, and the dialog's own surfaces around it.
 */
function ThemeDialog({
  open,
  editing,
  from,
  themes,
  scheme,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: Theme | null;
  from: Theme;
  themes: Theme[];
  scheme: ColorScheme;
  onClose: () => void;
  onSave: (d: Draft, editing: Theme | null) => void;
  onDelete: (t: Theme) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(from, editing, themes));
  // Dark is the starting theme's own near-black (Dune's brown, Ink's blue), or plain dark when it was black.
  const [darkBase, setDarkBase] = useState(DARK_BASE);
  const [opened, setOpened] = useState(false);
  if (open && !opened) {
    const d = draftOf(from, editing, themes);
    setDraft(d);
    setDarkBase(d.base === BLACK_BASE ? DARK_BASE : d.base);
    setOpened(true);
  } else if (!open && opened) setOpened(false);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = draft.name.trim() !== "";
  const submit = () => valid && onSave(draft, editing);
  const del = useConfirmDelete(() => editing && onDelete(editing), "Delete Theme");

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {/* Settings is a dialog too: a nested backdrop only draws when forced. */}
        <Dialog.Backdrop forceRender className="theme-dialog-scrim" />
        <Dialog.Popup className={`theme-dialog themed scheme-${scheme}`} style={themeStyle(draft, scheme) as CSSProperties}>
          <div className="theme-dialog-stage" aria-hidden>
            <ThemeThumb theme={draft} scheme={scheme} />
          </div>

          <div className="theme-dialog-body">
            <Dialog.Title className="theme-dialog-title">{editing ? "Edit theme" : "Create theme"}</Dialog.Title>
            <Dialog.Description className="theme-dialog-description">
              {editing ? "Changes apply when you save." : `A copy of ${from.name}, yours to change.`}
            </Dialog.Description>

            <div className="theme-dialog-rows">
              <label className="theme-dialog-row">
                <span className="theme-dialog-label">Name</span>
                <input
                  className="theme-dialog-input"
                  value={draft.name}
                  maxLength={MAX_THEME_NAME}
                  spellCheck={false}
                  onChange={(e) => set({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </label>
              <div className="theme-dialog-row">
                <span className="theme-dialog-label" id="theme-dialog-accent">
                  Accent
                </span>
                <div className="theme-dialog-swatches" role="radiogroup" aria-labelledby="theme-dialog-accent">
                  {THEME_ACCENTS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      className="theme-dialog-swatch"
                      role="radio"
                      aria-checked={draft.accent === a.value}
                      aria-label={a.label}
                      title={a.label}
                      style={{ "--swatch": a.value } as CSSProperties}
                      onClick={() => set({ accent: a.value })}
                    />
                  ))}
                </div>
              </div>
              <div className="theme-dialog-row">
                <span className="theme-dialog-label">Tint</span>
                <Segmented label="Tint" options={TINTS} value={nearestTint(draft.tint)} onChange={(tint) => set({ tint })} />
              </div>
              <div className="theme-dialog-row">
                <span className="theme-dialog-label">Background</span>
                <Segmented
                  label="Background"
                  options={[
                    { id: "dark", label: scheme === "light" ? "Light" : "Dark" },
                    { id: "black", label: scheme === "light" ? "White" : "Black" },
                  ]}
                  value={draft.base === BLACK_BASE ? "black" : "dark"}
                  onChange={(v) => set({ base: v === "black" ? BLACK_BASE : darkBase })}
                />
              </div>
            </div>
          </div>

          <div className="theme-dialog-foot">
            {editing && (
              <button type="button" className="theme-dialog-delete" {...del.props}>
                {del.armed ? "Click again to delete" : "Delete theme"}
              </button>
            )}
            <Dialog.Close className="theme-dialog-btn">Cancel</Dialog.Close>
            <button type="button" className="theme-dialog-btn theme-dialog-btn-primary" disabled={!valid} onClick={submit}>
              {editing ? "Save" : "Create"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
