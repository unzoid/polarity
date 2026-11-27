import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { ChevronRight, type Icon as IconT } from "../icons";
import { PAGE_SECTIONS, type PageId } from "../../lib/settings/pages";
import { prefersReducedMotion, springs, useFormFactor } from "../../lib/ui";
import { FamilyTray, MoreDots } from "./FamilyTray";
import { SECTION_ICONS } from "./pages";
import { SliderField } from "../SliderField";
import { Button, type ButtonVariant } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { TextField, type TextFieldProps } from "../ui/TextField";

/**
 * The settings building blocks (docs/ui-components.md §4, U26): a titled card of rows, and the
 * kinds of row in it. Styling in styles/screens.css (`.settings-*`) and the overlay's `.t3s` scope.
 */

/** A group of rows under an optional heading, with an optional note below. */
export function Card({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-group">
      {title && <h2 className="settings-group-title">{title}</h2>}
      <div className="settings-card">{children}</div>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  );
}

/**
 * A row's title and the caption under it. `status` (what the setting does right now) goes on a line
 * of its own under the caption, so the caption wraps the same with it and without it.
 */
export function RowText({ title, caption, status }: { title: string; caption?: ReactNode; status?: string | null }) {
  return (
    <span className="settings-row-text">
      <span className="settings-row-title">{title}</span>
      {(caption || status) && (
        <span className="settings-row-caption">
          {caption}
          {status && <span className="settings-row-status">{status}</span>}
        </span>
      )}
    </span>
  );
}

/** An on/off setting; the whole row is its label. */
export function ToggleRow({
  setting,
  title,
  caption,
  status,
  checked,
  onChange,
  disabled,
}: {
  /** The schema id (lib/settings/schema.ts), so search can find the row. */
  setting?: string;
  title: string;
  caption?: string;
  /** What the setting does right now, on its own line under the caption. */
  status?: string | null;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} status={status} />
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

/** A row with its control (a dropdown, chips, a button) on the right. */
export function PickRow({ setting, title, caption, children }: { setting?: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} />
      {children}
    </div>
  );
}

/**
 * A row with one button that does something now ("Sign Out", "Clear"). While `pending`
 * the button is disabled and reads `pendingLabel` (default: `label`).
 */
export function ActionRow({
  setting,
  title,
  caption,
  label,
  glyph,
  variant,
  onClick,
  disabled,
  pending,
  pendingLabel,
}: {
  setting?: string;
  title: string;
  caption?: ReactNode;
  label: ReactNode;
  /** A small icon before the label, sized by the caller (15px in settings). */
  glyph?: ReactNode;
  variant?: ButtonVariant;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
}) {
  return (
    <div className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} />
      <Button variant={variant} disabled={disabled || pending} onClick={onClick}>
        {glyph}
        {pending ? (pendingLabel ?? label) : label}
      </Button>
    </div>
  );
}

/**
 * One text field and its submit button. The button is enabled when the tidied value
 * (`tidy`, default trim) differs from `saved`, or, with no `saved`, when it isn't empty;
 * `onSubmit` gets the tidied value. `look="expand"` lays it out inside an `ExpandRow`.
 * Other props go to the field (`placeholder`, `aria-label`, `type`…).
 */
export function FormRow({
  setting,
  title,
  trayTitle,
  trayHint,
  emptyValue = "Add",
  icon: Icon,
  value,
  onChange,
  onSubmit,
  saved,
  tidy = (v) => v.trim(),
  submit = "Save",
  glyph,
  pending,
  pendingLabel,
  error,
  look = "row",
  spellCheck = false,
  ...field
}: Omit<TextFieldProps, "onSubmit" | "look"> & {
  setting?: string;
  /** Row label used on phone to open the Family input tray (falls back to aria-label or submit). */
  title?: string;
  /** Heading inside the phone Family input tray. */
  trayTitle?: string;
  /** Optional hint line shown inside the phone Family input tray above the field. */
  trayHint?: string;
  /** Right-side label on phone when no saved value is present. */
  emptyValue?: string;
  icon?: IconT;
  onSubmit: (value: string) => void;
  saved?: string;
  tidy?: (value: string) => string;
  submit?: ReactNode;
  glyph?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  /** Shown under the row. */
  error?: ReactNode;
  look?: "row" | "expand";
}) {
  const phone = useFormFactor().form === "phone";
  const [trayOpen, setTrayOpen] = useState(false);
  const next = tidy(value);
  const ready = saved === undefined ? next !== "" : next !== saved;

  if (phone && look === "row") {
    const rowTitle = title ?? (typeof field["aria-label"] === "string" ? field["aria-label"] : typeof submit === "string" ? submit : "Edit");
    const display = saved && saved.trim() ? saved : emptyValue;
    return (
      <>
        <button
          type="button"
          className="settings-row settings-row-button ft-choice-row"
          data-setting={setting}
          aria-haspopup="dialog"
          aria-expanded={trayOpen}
          onClick={() => setTrayOpen(true)}
        >
          {Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />}
          <RowText title={rowTitle} />
          <span className="ft-choice-right">
            <span className="ft-choice-value">{display}</span>
            <MoreDots size={16} className="ft-choice-dots" />
          </span>
        </button>
        <FamilyTray open={trayOpen} onClose={() => setTrayOpen(false)} title={trayTitle ?? rowTitle} stepKey={rowTitle}>
          {trayHint && <p className="ft-desc">{trayHint}</p>}
          <form
            className="ft-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !pending) {
                onSubmit(next);
                if (!error) setTrayOpen(false);
              }
            }}
          >
            <TextField value={value} onChange={onChange} spellCheck={spellCheck} autoFocus {...field} />
            {error && (
              <p className="ft-desc ft-desc-error" role="alert">
                {error}
              </p>
            )}
            <div className="ft-actions">
              <button type="submit" className="ft-pill ft-pill-cta" disabled={!ready || pending}>
                {glyph}
                {pending ? (pendingLabel ?? submit) : submit}
              </button>
            </div>
          </form>
        </FamilyTray>
      </>
    );
  }

  return (
    <>
      <form
        className={look === "row" ? "settings-row" : "settings-expand-form"}
        data-setting={setting}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !pending) onSubmit(next);
        }}
      >
        <TextField value={value} onChange={onChange} spellCheck={spellCheck} {...field} />
        <Button variant="primary" disabled={!ready || pending}>
          {glyph}
          {pending ? (pendingLabel ?? submit) : submit}
        </Button>
      </form>
      {error && <p className="settings-error settings-card-pad">{error}</p>}
    </>
  );
}

/**
 * A number setting as a slider with the exact value in a box beside it, which
 * you can type into. `zero` names what 0 means ("Never", "Any size").
 */
export function NumberRow({
  setting,
  title,
  caption,
  value,
  min,
  max,
  step,
  unit,
  zero,
  onChange,
}: {
  setting?: string;
  title: string;
  caption?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  zero?: string;
  onChange: (n: number) => void;
}) {
  return (
    <PickRow setting={setting} title={title} caption={caption}>
      <SliderField label={title} value={value} min={min} max={max} step={step} unit={unit} zero={zero} onChange={onChange} />
    </PickRow>
  );
}

/** What `useExpanded` hands each row. */
export type Expandable = { open: boolean; onToggle: () => void };

/** A row that opens in place to show its controls. */
export function ExpandRow({
  icon: Icon,
  lead,
  title,
  caption,
  value,
  open,
  onToggle,
  setting,
  accessory,
  handle,
  inline,
  children,
}: Expandable & {
  /** The schema id (lib/settings/schema.ts) or another name the page finds the row by. */
  setting?: string;
  icon?: IconT;
  /** A picture of its own where the icon goes (an add-on's logo), when a glyph won't do. */
  lead?: ReactNode;
  title: string;
  caption?: ReactNode;
  /** Short current state on the right ("On", a server address…). */
  value?: ReactNode;
  /** Small buttons of their own beside the chevron (an add-on's Copy Link): over the row, not inside its button. */
  accessory?: ReactNode;
  /** A control of its own at the row's start, over its edge (an add-on's drag handle). */
  handle?: ReactNode;
  /** Keep inline expansion even on phone when a caller explicitly opts out of the Family tray. */
  inline?: boolean;
  children: ReactNode;
}) {
  const phone = useFormFactor().form === "phone";
  if (phone && !inline) {
    const row = (
      <button
        type="button"
        className="settings-row settings-row-button ft-choice-row"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        {lead ?? (Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />)}
        <RowText title={title} caption={caption} />
        <span className="ft-choice-right">
          {value != null && <span className="ft-choice-value">{value}</span>}
          <MoreDots size={16} className="ft-choice-dots" />
        </span>
      </button>
    );
    return (
      <div className="settings-expand" data-open={open} data-setting={setting}>
        {handle ? (
          <div className="settings-expand-head">
            {row}
            <div className="settings-expand-handle">{handle}</div>
          </div>
        ) : (
          row
        )}
        <FamilyTray open={open} onClose={onToggle} title={title} stepKey={title}>
          <div className="ft-tray-body">{children}</div>
        </FamilyTray>
      </div>
    );
  }

  const row = (
    <button className="settings-row settings-row-button" aria-expanded={open} onClick={onToggle} data-accessory={accessory ? "" : undefined}>
      {lead ?? (Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />)}
      <RowText title={title} caption={caption} />
      {value != null && <span className="settings-row-value">{value}</span>}
      <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
    </button>
  );
  return (
    <div className="settings-expand" data-open={open} data-setting={setting}>
      {accessory || handle ? (
        <div className="settings-expand-head">
          {row}
          {handle && <div className="settings-expand-handle">{handle}</div>}
          {accessory && <div className="settings-expand-accessory">{accessory}</div>}
        </div>
      ) : (
        row
      )}
      {/* Opening grows the card to fit what's inside and closing folds it back (Family: a surface changes its height
          rather than jumping), the rows below carried along. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="settings-expand-reveal"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={prefersReducedMotion() ? { duration: 0 } : { ...springs.sheet, opacity: { duration: 0.18 } }}
          >
            <div className="settings-expand-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A row that leads somewhere else. */
export function LinkRow({ icon: Icon, title, caption, onClick }: { icon?: IconT; title: string; caption?: string; onClick: () => void }) {
  return (
    <button className="settings-row settings-row-button" onClick={onClick}>
      {Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />}
      <RowText title={title} caption={caption} />
      <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
    </button>
  );
}

/** What a page split into sections (PAGE_SECTIONS) is given: the section open (null: its list), and how to open one. */
export type SectionProps = { section: string | null; openSection: (id: string) => void };

/** A long page's list of sections, each opening a view of its own. */
export function SectionList({ page, openSection }: { page: PageId; openSection: (id: string) => void }) {
  return (
    <Card>
      {(PAGE_SECTIONS[page] ?? []).map((s) => (
        <LinkRow key={s.id} icon={SECTION_ICONS[s.id]} title={s.label} caption={s.caption} onClick={() => openSection(s.id)} />
      ))}
    </Card>
  );
}

/** One open row per card; clicking it again closes it. `initial` picks the row open at first. */
export function useExpanded(initial: () => string | null = () => null) {
  const [open, setOpen] = useState<string | null>(initial);
  return (id: string): Expandable => ({ open: open === id, onToggle: () => setOpen((o) => (o === id ? null : id)) });
}
