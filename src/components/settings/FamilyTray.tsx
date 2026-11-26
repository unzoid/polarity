import "../../styles/family-settings-phone.css";
import { AnimatePresence, animate, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, Close, Reset } from "../icons";
import { prefersReducedMotion, project, rubberband, springs, useDismiss } from "../../lib/ui";
import { maskStyle, useAppleCorners } from "../../lib/ui/cornerSmoothing";

/** Crisp rounded outline warning triangle matching Family's Clear Cache / destructive icon. */
export function FamilyWarningIcon({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Vertical three-dots affordance for rows that open a Family Tray rather than pushing a page. */
export function MoreDots({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <circle cx="12" cy="5.5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="18.5" r="1.75" />
    </svg>
  );
}

/**
 * Mobile-only Family-style floating dynamic tray (1:1 to Family iOS):
 * - Floating detached card (`border-radius: 36px`, inset `10px` from edges + safe areas)
 *   over a clean dimming scrim — underlying page stays still under the scrim.
 * - Dynamically morphs its height with a critically damped spring when `stepKey` changes,
 *   while cross-blur-fading step content directionally.
 * - Supports 1:1 drag-to-dismiss with upward rubber-banding and Apple velocity projection.
 * - Registers on `useDismiss` so Android Back / Escape closes it before Settings.
 */
export function FamilyTray({
  open,
  onClose,
  title,
  heroIcon,
  stepKey = "root",
  direction = "forward",
  onBack,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional hero icon shown above the title beside the close button (Family Clear Cache / confirmation style). */
  heroIcon?: ReactNode;
  /** Change this across steps inside the same tray to trigger height-morphing + blur-fade. */
  stepKey?: string;
  direction?: "forward" | "back";
  onBack?: () => void;
  children: ReactNode;
}) {
  useDismiss(open, onClose);
  const reduced = prefersReducedMotion();

  const trayRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    if (!open) {
      setHeight("auto");
      return;
    }
    const el = measureRef.current;
    if (!el) return;
    const sync = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setHeight(h);
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, stepKey]);

  // Apple 60% corner smoothing matching Family's iOS continuous tray curve (~31px flat tangent, ~8.6px corner inset).
  // Set borderRadius: 0 whenever clipPath is active so circular border-radius never cuts inside the squircle.
  // 34 at 60% smoothing: the corner reaches 54 along each edge, as the tray's always has.
  const corners = useAppleCorners(trayRef, 34, 60, open);
  const drag = useTrayDragDown(onClose);
  const stepShift = reduced ? 0 : direction === "forward" ? 14 : -14;

  // Lift the tray cleanly above the on-screen keyboard if visualViewport shrinks without resizing the layout viewport.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const syncKb = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const el = backdropRef.current;
      if (!el) return;
      if (kb > 40) {
        el.style.setProperty("--ft-kb", `${kb}px`);
        el.dataset.kbOpen = "";
      } else {
        el.style.removeProperty("--ft-kb");
        delete el.dataset.kbOpen;
      }
    };
    syncKb();
    vv.addEventListener("resize", syncKb);
    vv.addEventListener("scroll", syncKb);
    return () => {
      vv.removeEventListener("resize", syncKb);
      vv.removeEventListener("scroll", syncKb);
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={backdropRef}
          className="ft-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="ft-tray-wrap"
            initial={reduced ? { opacity: 0 } : { y: 48, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 40, scale: 0.97, opacity: 0 }}
            transition={reduced ? { duration: 0.1 } : { ...springs.sheet, opacity: { duration: 0.16 } }}
            {...drag}
          >
            <div
              ref={trayRef}
              className="ft-tray"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              style={maskStyle(corners.mask)}
            >
              <motion.div
                className="ft-viewport"
                animate={{ height }}
                transition={reduced ? { duration: 0 } : springs.sheet}
              >
                <div ref={measureRef} className="ft-measure">
                  <AnimatePresence mode="popLayout" initial={false} custom={stepShift}>
                    <motion.div
                      key={stepKey}
                      className="ft-step"
                      custom={stepShift}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, x: stepShift, scale: 0.985 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -stepShift, scale: 0.985 }}
                      transition={reduced ? { duration: 0.08 } : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    >
                      {heroIcon ? (
                        <>
                          <div className="ft-head ft-head-hero" data-ft-drag>
                            <div className="ft-head-left">
                              {onBack && (
                                <button type="button" className="ft-circle-btn" aria-label="Back" onClick={onBack}>
                                  <ChevronLeft size={16} strokeWidth={2.5} />
                                </button>
                              )}
                              <span className="ft-hero-glyph" aria-hidden>
                                {heroIcon}
                              </span>
                            </div>
                            <button type="button" className="ft-circle-btn" aria-label="Close" onClick={onClose}>
                              <Close size={15} strokeWidth={2.5} />
                            </button>
                          </div>
                          <h3 className="ft-title ft-title-hero">{title}</h3>
                        </>
                      ) : (
                        <div className="ft-head" data-ft-drag>
                          <div className="ft-head-left">
                            {onBack && (
                              <button type="button" className="ft-circle-btn" aria-label="Back" onClick={onBack}>
                                <ChevronLeft size={16} strokeWidth={2.5} />
                              </button>
                            )}
                            <h3 className="ft-title">{title}</h3>
                          </div>
                          <button type="button" className="ft-circle-btn" aria-label="Close" onClick={onClose}>
                            <Close size={15} strokeWidth={2.5} />
                          </button>
                        </div>
                      )}
                      {children}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * 1:1 Family choice picker tray (Choose Currency / Search Engine / Keep History):
 * Clean borderless rows directly on the tray surface, a springing circular accent checkmark on the
 * selected row, and a full-width pill Done CTA at the bottom.
 */
export function FamilyPickerTray<V extends string | number | boolean>({
  open,
  onClose,
  title,
  value,
  options,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: V;
  options: { value: V; label: string }[];
  onPick: (value: V) => void;
}) {
  return (
    <FamilyTray open={open} onClose={onClose} title={title} stepKey={title}>
      <div className="ft-picker-list" role="radiogroup" aria-label={title}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`ft-picker-opt${selected ? " is-selected" : ""}`}
              onClick={() => onPick(opt.value)}
            >
              <span className="ft-picker-label">{opt.label}</span>
              <span className="ft-picker-check" aria-hidden>
                <Check size={13} strokeWidth={3.2} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="ft-actions ft-picker-foot">
        <button type="button" className="ft-pill ft-pill-cta" onClick={onClose}>
          Done
        </button>
      </div>
    </FamilyTray>
  );
}

/**
 * 1:1 Family confirmation tray (Clear Cache / destructive action):
 * Large red outline warning icon top-left, × circle top-right, bold title below,
 * muted description, and 50/50 Cancel + red Confirm pill buttons.
 */
export function FamilyConfirmTray({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  return (
    <FamilyTray
      open={open}
      onClose={onClose}
      title={title}
      heroIcon={destructive ? <FamilyWarningIcon size={36} className="ft-warn-ico" /> : undefined}
      stepKey={title}
    >
      <p className="ft-desc">{description}</p>
      {error && (
        <p className="ft-desc ft-desc-error" role="alert">
          {error}
        </p>
      )}
      <div className="ft-actions">
        <button type="button" className="ft-pill ft-pill-secondary" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`ft-pill ${destructive ? "ft-pill-destructive" : "ft-pill-cta"}`}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </FamilyTray>
  );
}

/**
 * Hold-to-confirm pill button: `clip-path` fills linearly while held (1150ms) and snaps back
 * smoothly on early release (200ms ease-out).
 */
export function FamilyHoldButton({
  label,
  holdingLabel,
  onComplete,
}: {
  label: string;
  holdingLabel: string;
  onComplete: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = () => {
    window.clearTimeout(timer.current);
    setHolding(true);
    const delay = prefersReducedMotion() ? 250 : 1150;
    timer.current = window.setTimeout(() => {
      setHolding(false);
      doneRef.current();
    }, delay);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      type="button"
      className={`ft-pill ft-pill-danger${holding ? " is-holding" : ""}`}
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
    >
      <span>{label}</span>
      <span className="ft-hold-fill" aria-hidden>
        <span>{holdingLabel}</span>
      </span>
    </button>
  );
}

/** Multi-step height-morphing Family Tray for "Restore device defaults" on phone. */
export function FamilyResetTray({
  open,
  onClose,
  onConfirmReset,
}: {
  open: boolean;
  onClose: () => void;
  onConfirmReset: () => void;
}) {
  const [step, setStep] = useState<"intro" | "confirm" | "done">("intro");
  const [dir, setDir] = useState<"forward" | "back">("forward");

  useEffect(() => {
    if (!open) {
      setStep("intro");
      setDir("forward");
    }
  }, [open]);

  const go = (next: "intro" | "confirm" | "done", d: "forward" | "back") => {
    setDir(d);
    setStep(next);
  };

  const titles = {
    intro: "Restore Defaults",
    confirm: "Confirm Reset",
    done: "All Set",
  } as const;

  return (
    <FamilyTray
      open={open}
      onClose={onClose}
      title={titles[step]}
      stepKey={step}
      direction={dir}
      onBack={step === "confirm" ? () => go("intro", "back") : undefined}
    >
      {step === "intro" && (
        <>
          <div className="ft-hero-badge ft-hero-danger" aria-hidden>
            <Reset size={22} strokeWidth={2.2} />
          </div>
          <p className="ft-desc">
            Resets playback, layout, downloads and sounds saved on this device. Your library and add-ons stay as they are.
          </p>
          <div className="ft-actions">
            <button type="button" className="ft-pill ft-pill-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ft-pill ft-pill-destructive" onClick={() => go("confirm", "forward")}>
              Continue
            </button>
          </div>
        </>
      )}
      {step === "confirm" && (
        <>
          <p className="ft-desc">Press and hold to restore device defaults.</p>
          <div className="ft-actions">
            <FamilyHoldButton
              label="Hold to Reset"
              holdingLabel="Resetting…"
              onComplete={() => {
                onConfirmReset();
                go("done", "forward");
              }}
            />
          </div>
        </>
      )}
      {step === "done" && (
        <>
          <div className="ft-done-row">
            <span className="ft-done-dot" aria-hidden>
              <Check size={16} strokeWidth={3} />
            </span>
            <span className="ft-done-text">Device defaults restored.</span>
          </div>
          <div className="ft-actions">
            <button type="button" className="ft-pill ft-pill-cta" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </FamilyTray>
  );
}

/** 1:1 vertical drag-to-dismiss for a Family Tray, with rubber-banding upward and momentum projection. */
function useTrayDragDown(close: () => void) {
  const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; vy: number; dy: number } | null>(null);
  const anim = useRef<ReturnType<typeof animate> | null>(null);

  const settle = (el: HTMLElement, target: number, velocity: number, onDone?: () => void) => {
    anim.current?.stop();
    if (prefersReducedMotion()) {
      el.style.transform = target === 0 ? "" : `translateY(${target}px)`;
      onDone?.();
      return;
    }
    const ctrl = animate(
      el,
      { y: target },
      {
        ...springs.sheet,
        velocity,
        onComplete: () => {
          if (anim.current === ctrl) anim.current = null;
          if (target === 0) el.style.transform = "";
          onDone?.();
        },
      },
    );
    anim.current = ctrl;
  };

  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      if (drag.current || e.button !== 0) return;
      if (!t.closest("[data-ft-drag]") || t.closest("button, input, a")) return;
      const el = e.currentTarget;
      anim.current?.stop();
      anim.current = null;
      el.setPointerCapture(e.pointerId);
      const now = performance.now();
      drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: now, vy: 0, dy: 0 };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const now = performance.now();
      const dt = now - d.lastT;
      if (dt > 0) {
        const inst = ((e.clientY - d.lastY) / dt) * 1000;
        d.vy = d.vy === 0 ? inst : inst * 0.6 + d.vy * 0.4;
        d.lastY = e.clientY;
        d.lastT = now;
      }
      const raw = e.clientY - d.startY;
      const h = e.currentTarget.offsetHeight || 280;
      d.dy = raw < 0 ? -rubberband(-raw, h, 0.22) : raw;
      e.currentTarget.style.transform = `translateY(${d.dy}px)`;
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      const el = e.currentTarget;
      const h = el.offsetHeight || 280;
      const stale = performance.now() - d.lastT > 80;
      const vy = stale ? 0 : d.vy;
      const projected = d.dy + project(vy, 0.992);
      const shouldClose = vy >= -120 && (d.dy > 85 || projected > h * 0.36 || (d.dy > 20 && vy > 110));
      if (shouldClose) {
        settle(el, h + 40, Math.max(0, vy));
        close();
      } else {
        settle(el, 0, vy);
      }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      settle(e.currentTarget, 0, 0);
    },
  };
}
