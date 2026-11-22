import { animate, AnimatePresence, motion, useDragControls, useMotionValue, type PanInfo } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { os } from "../lib/platform";
import { type Detent, ease, mediumOffset, missMargin, prefersReducedMotion, project, restingDetent, springs, useFormFactor, useLayer } from "../lib/ui";

/**
 * A side sheet that enters from the right and leaves the same way; on a phone, a
 * bottom sheet that rises from the bottom edge and is pulled down by its header
 * (the list inside keeps its own vertical scroll).
 *
 * - Interruptible: it's a spring on a motion value, so a sheet that's closing
 *   can be grabbed and pulled back mid-flight.
 * - Drag-to-dismiss uses momentum projection: a short flick closes it even if
 *   the finger barely moved, because we decide on where the throw *lands*.
 * - Dragging the wrong way (left) rubber-bands instead of hitting a wall.
 * - A modal sheet takes focus when it opens, keeps Tab inside and gives focus back when it closes.
 * - On an iPhone it rests at iOS's detents (lib/ui/detents.ts), as the system's own sheets do: it opens at half
 *   the screen, its header pulls it up to nearly all of it or down to close, scrolling the list expands it, and
 *   the grabber toggles between the two.
 */
/** Each time a full sheet has the pages step back: a close that lands after the next open leaves them be. */
let stepsBack = 0;
/** The pages stepping back, on the sheet's spring (springs.profileSheet: critically damped, ω 20/s), sampled. */
const STEP_BACK_MS = 420;
function stepBackFrames(from: number, to: number): Keyframe[] {
  const n = 24;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = (20 * STEP_BACK_MS * i) / n / 1000;
    const p = i === n ? 1 : 1 - (1 + u) * Math.exp(-u);
    return { offset: i / n, transform: `scale(${from + (to - from) * p})` };
  });
}

/** Estimate initial iOS detent sheet height to avoid a double-render layout pass on frame 0. */
function estimateStops() {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const height = Math.max(240, vh - 56);
  return { height, medium: mediumOffset(height, vh) };
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  modal = true,
  forgiveMisses = false,
  full = false,
  closeButton = false,
}: {
  /** A round close at the header's end (the phone shell's sheets, as Netflix's have). */
  closeButton?: boolean;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Modal sheets dim what's behind; non-modal ones keep the flow visible. */
  modal?: boolean;
  /** A click on the dim just left of a side sheet does nothing; only one clearly away from it closes it (#320). */
  forgiveMisses?: boolean;
  /**
   * On a phone, a place of its own (the profile sheet, with Settings inside): it opens at the screen's full height,
   * on an iPhone too, rather than resting at half with detents, and stays that height whatever its view holds.
   */
  full?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const bottom = useFormFactor().form === "phone";
  const detents = bottom && os === "ios" && !full;
  const back = bottom && full;
  const spring = back ? springs.profileSheet : bottom ? springs.bottomSheet : springs.sheet;
  const x = useMotionValue(0);
  // A sheet with detents starts below the screen, and a closed one ends there, so it never shows a frame at the top.
  const y = useMotionValue(detents ? window.innerHeight : 0);
  const [detent, setDetent] = useState<Detent>("medium");
  const touchY = useRef(0);
  /** The sheet's large height and its medium offset, pre-estimated and refined on mount/resize only if needed. */
  const [stops, setStops] = useState(estimateStops);
  // With less motion Motion drops the slide; a fade keeps it from popping in and out.
  const fade = prefersReducedMotion() ? 0 : 1;

  useLayer(panel, open, onClose, { modal });

  // A phone's full sheet (the profile sheet) has the pages and the top bar step back under it, smaller and rounded,
  // as Netflix's does, on the sheet's own spring. They're left as they were once back: a scale left on them would
  // hold anything fixed inside them in their box.
  useLayoutEffect(() => {
    // `.ph-stage`: the phone shell's tabs (src/phone), which step back the same way.
    const main = back && open && !prefersReducedMotion() ? document.querySelector<HTMLElement>(".main, .ph-stage") : null;
    if (!main) return;
    const step = ++stepsBack;
    // On the compositor (the Web Animations API, the spring sampled), the corners set once rather than animated:
    // the main thread laying out or painting anything meanwhile doesn't hold the pages' step back up.
    main.dataset.stepBack = "";
    const ease = { duration: STEP_BACK_MS, easing: "linear", fill: "forwards" } as const;
    const from = main.getAnimations().find((a) => a.id === "step-back");
    from?.cancel();
    const out = main.animate(stepBackFrames(1, 0.92), { ...ease, id: "step-back" });
    return () => {
      // From wherever it is, if it closes before it's all the way back.
      const now = getComputedStyle(main).transform;
      const at = now && now !== "none" ? new DOMMatrix(now).a : 0.92;
      out.cancel();
      const home = main.animate(stepBackFrames(at, 1), { ...ease, id: "step-back" });
      void home.finished
        .then(() => {
          if (step !== stepsBack) return; // opened again meanwhile
          home.cancel();
          delete main.dataset.stepBack;
        })
        .catch(() => {});
    };
  }, [back, open]);

  /** The kind of pointer that pressed on the dim: a finger gets a wider margin than a mouse. */
  const pointer = useRef("mouse");
  const onScrimClick = (e: { clientX: number }) => {
    const edge = panel.current?.getBoundingClientRect().left;
    if (forgiveMisses && !bottom && edge !== undefined && e.clientX >= edge - missMargin(pointer.current).x) return;
    onClose();
  };

  // Hand off the finger's exact release velocity into the spring whether switching detents or returning to the same one.
  const rest = (to: Detent, velocity = 0) => {
    const target = to === "large" ? 0 : stops.medium;
    if (prefersReducedMotion()) y.set(target);
    else animate(y, target, { ...spring, velocity });
    if (to !== detent) setDetent(to);
  };

  useLayoutEffect(() => {
    if (!open || !detents) return;
    const measure = () => {
      const height = panel.current?.offsetHeight ?? window.innerHeight;
      const medium = mediumOffset(height, window.innerHeight);
      setStops((prev) => (Math.abs(prev.height - height) <= 2 && Math.abs(prev.medium - medium) <= 2 ? prev : { height, medium }));
    };
    measure();
    setDetent("medium");
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, detents]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (detents) {
      const next = restingDetent(y.get() + project(info.velocity.y), stops.medium, stops.height);
      return next ? rest(next, info.velocity.y) : onClose();
    }
    const size = (bottom ? panel.current?.offsetHeight : panel.current?.offsetWidth) ?? 400;
    const landing = bottom ? info.offset.y + project(info.velocity.y) : info.offset.x + project(info.velocity.x);
    if (landing > size / 2) onClose();
    else if (!prefersReducedMotion()) {
      animate(bottom ? y : x, 0, { ...spring, velocity: bottom ? info.velocity.y : info.velocity.x });
    }
  };
  const medium = detents && detent === "medium";
  const away = detents ? { y: stops.height, opacity: fade } : bottom ? { y: "100%", opacity: fade } : { x: "100%", opacity: fade };

  const content = (
    <AnimatePresence>
      {open && (
        <>
          {modal && (
            <motion.div
              className="sheet-scrim"
              data-edge={bottom ? "bottom" : "right"}
              data-full={back ? "" : undefined}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // On a phone the dim comes up with the sheet rather than ahead of it.
              transition={{ duration: bottom ? 0.4 : 0.2, ease: ease.out }}
              onPointerDown={(e) => (pointer.current = e.pointerType)}
              onClick={onScrimClick}
            />
          )}
          <motion.aside
            ref={panel}
            className="sheet"
            role="dialog"
            aria-modal={modal}
            tabIndex={-1}
            data-layer=""
            data-edge={bottom ? "bottom" : "right"}
            data-detent={detents ? detent : undefined}
            data-full={bottom && full ? "" : undefined}
            style={bottom ? { y } : { x }}
            // With detents the sheet starts below the screen (`y`) and rises immediately to its medium detent.
            initial={detents ? { y: stops.height, opacity: fade } : away}
            animate={{ ...(detents ? { y: detent === "large" ? 0 : stops.medium } : bottom ? { y: 0 } : { x: 0 }), opacity: 1, transition: spring }}
            exit={{ ...away, transition: spring }} // velocity carries over from a flick; no bounce needed off-screen
            drag={bottom ? "y" : "x"}
            // A bottom sheet is pulled by its header only: the list below scrolls up and down.
            dragControls={bottom ? drag : undefined}
            dragListener={!bottom}
            dragDirectionLock
            dragConstraints={detents ? { top: 0 } : bottom ? { top: 0, bottom: 0 } : { left: 0, right: 0 }}
            dragElastic={bottom ? { top: 0.08, bottom: 1 } : { left: 0.08, right: 1 }} // resist away from the edge, follow towards it 1:1
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
            onDragEnd={onDragEnd}
          >
            <header className="sheet-header" onPointerDown={bottom ? (e) => drag.start(e) : undefined}>
              {detents ? (
                <button
                  className="sheet-grabber"
                  aria-label={detent === "medium" ? "Expand" : "Collapse"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => rest(detent === "medium" ? "large" : "medium")}
                />
              ) : (
                bottom && <div className="sheet-grabber" aria-hidden />
              )}
              <div>
                <h2 className="t-title2">{title}</h2>
                {subtitle && <p className="t-caption muted">{subtitle}</p>}
              </div>
              {/* The phone shell's sheets all have one, the shared ones (Sources, Download) too. */}
              {(closeButton || (bottom && document.documentElement.dataset.phoneUi !== undefined)) && (
                <button type="button" className="sheet-close" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              )}
            </header>
            <div
              className="sheet-body"
              // Scrolling the list at half height, or pushing it up, brings the rest of it up first, as iOS's sheets do.
              onScroll={medium ? (e) => e.currentTarget.scrollTop > 0 && rest("large") : undefined}
              onTouchStart={medium ? (e) => (touchY.current = e.touches[0].clientY) : undefined}
              onTouchMove={medium ? (e) => touchY.current - e.touches[0].clientY > 10 && rest("large") : undefined}
            >
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
