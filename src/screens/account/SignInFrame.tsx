import "../../styles/signin.css";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "../../components/ui/Popover";
import { ease, prefersReducedMotion, springs } from "../../lib/ui";
import { SignInMark } from "./SignInMark";

/**
 * The sign-in's frame, after Family's. On a phone: one column with a bar across the top (close or back, a dash per
 * step, help), the step in the middle and one wide button at the foot. Wider (a computer, a TV): the same column
 * centred under the Polarity wordmark, as the sign-in always was, each step's button right under its field.
 *
 * Changing step, wide: the whole step sinks out and the next settles in (`settle`, the sign-in's change from before).
 * On a phone, as Family does:
 * - between questions, the step slides out sideways and fades while the next comes in after it from the other side
 *   (forward to the left, back to the right), across the whole window (nothing clips it to the column);
 * - out of the opening, the opening dissolves while the first question fades in where it stands, and the button that
 *   was pressed becomes that step's Continue: it travels to Continue's place, takes its colour, and its words change
 *   half-way (`handOff`).
 * The bar stays put; on a phone so does the button.
 */
export type Lead = { icon: "close" | "back"; label: string; onPress: () => void } | null;
export type PrimaryAction = { label: string; enabled: boolean; busy?: boolean; onPress: () => void };

/** Wide enough for the computer layout (the button under the field, the wordmark over the column). */
const WIDE = "(min-width: 760px) and (min-height: 540px)";
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useWideSignIn() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches);
}

/** Each step's own slot (its key), so a step on its way out can't take the button back from the one coming in. */
const PrimarySlot = createContext<{ owner: string; inline: boolean; set: (owner: string, p: PrimaryAction | null) => void } | null>(null);

/** A pressed button on its way to becoming the next step's Continue. */
type Hand = { rect: DOMRect; label: string; bg: string; fg: string; radius: string; at: number };
const Handoff = createContext<{ give: (from: HTMLElement) => void; take: () => Hand | null; done: () => void }>({
  give: () => {},
  take: () => null,
  done: () => {},
});

/** For the opening's buttons: call with the pressed button just before moving on, and it becomes the next Continue. */
export function useHandOff() {
  return useContext(Handoff).give;
}

/**
 * The step's button. Wide, it's drawn here, in the step, under its field; on a phone it goes to the frame's foot
 * (drawn there in place, not sliding with the step).
 */
export function Primary(p: PrimaryAction) {
  const slot = useContext(PrimarySlot);
  const inline = !!slot?.inline;
  useLayoutEffect(() => {
    if (!inline) slot?.set(slot.owner, p);
  });
  useLayoutEffect(() => {
    if (inline) return;
    const s = slot;
    return () => s?.set(s.owner, null);
    // On unmount (or switching layout) only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);
  return inline ? <PrimaryButton {...p} /> : null;
}

/** The morph's timing, off Family's (40 fps): there in ≈380 ms; the colour turns within the first ~110 ms. */
const MORPH_MS = 380;

function PrimaryButton({ label, enabled, busy, onPress }: PrimaryAction) {
  const el = useRef<HTMLButtonElement>(null);
  const { take, done: handed } = useContext(Handoff);
  useLayoutEffect(() => {
    // Read, not used up: React's dev StrictMode runs this twice (mount, clean up, mount), and the second run must
    // still find it. It's cleared when the travel ends, and goes stale on its own.
    const hand = take();
    const to = el.current;
    if (!hand || !to || prefersReducedMotion()) return;
    // A stand-in over everything does the travelling (the step it lands in is still fading in); the real button
    // shows once it's there.
    const r = to.getBoundingClientRect();
    const cs = getComputedStyle(to);
    const ghost = document.createElement("div");
    ghost.className = "si-primary-ghost";
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const was = document.createElement("span");
    was.textContent = hand.label;
    was.style.color = hand.fg;
    const now = document.createElement("span");
    now.textContent = label;
    now.style.color = cs.color;
    ghost.append(was, now);
    document.body.append(ghost);
    to.style.visibility = "hidden";
    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const move = ghost.animate(
      [
        {
          transform: `translate(${hand.rect.left - r.left}px, ${hand.rect.top - r.top}px)`,
          width: `${hand.rect.width}px`,
          height: `${hand.rect.height}px`,
          borderRadius: hand.radius,
        },
        { transform: "none", width: `${r.width}px`, height: `${r.height}px`, borderRadius: cs.borderRadius },
      ],
      { duration: MORPH_MS, easing: ease },
    );
    ghost.animate([{ backgroundColor: hand.bg }, { backgroundColor: cs.backgroundColor }], { duration: 140, easing: "ease-out", fill: "both" });
    was.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: 70, fill: "both" });
    now.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 150, fill: "both" });
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      ghost.remove();
      to.style.removeProperty("visibility");
    };
    // A run cleaned up early (StrictMode's second mount, or leaving mid-flight) is over: its cancelled animation's
    // late rejection mustn't show the button the next run has just hidden.
    void move.finished.then(
      () => {
        if (!over) handed();
        done();
      },
      () => {},
    );
    return () => {
      done();
      move.cancel();
    };
    // Once, as it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button ref={el} type="button" className="si-primary" disabled={!enabled || busy} data-busy={busy || undefined} onClick={onPress}>
      {label}
      {busy && <Spin className="si-primary-spin" />}
    </button>
  );
}

/** Family's spinner (Tailwind's `animate-spin` look): a faint ring with a quarter of it lit, turning once a second. */
export function Spin({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg className={className ? `si-spin ${className}` : "si-spin"} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * `slide`, between questions (measured off Family's at 40 fps): the next step starts about a third of the column to
 * the side and settles in ≈250 ms; the old one drifts a quarter of the way out and is gone in ≈150 ms.
 * `dissolve`, out of the opening or back to it: the old one fades over ≈250 ms, the new one fades in where it stays.
 */
type Turn = { dir: number; dissolve: boolean };
const steps: Variants = {
  enter: ({ dir, dissolve }: Turn) => (dissolve ? { x: "0%", opacity: 0 } : { x: `${dir * 34}%`, opacity: 0 }),
  shown: ({ dissolve }: Turn) =>
    dissolve
      ? { x: "0%", opacity: 1, transition: { opacity: { duration: 0.22, delay: 0.06, ease: [0.23, 1, 0.32, 1] } } }
      : {
          x: "0%",
          opacity: 1,
          transition: { x: { type: "spring", stiffness: 340, damping: 36 }, opacity: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
        },
  leave: ({ dir, dissolve }: Turn) =>
    dissolve
      ? { opacity: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.6, 1] } }
      : { x: `${dir * -26}%`, opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.6, 1] } },
};
/**
 * Wide (a computer, a TV), the sign-in's own change from before, after Linear's: the whole step fades out with a
 * barely-there sink (98%), then the next fades in and settles to full size on a gentle spring, all of it together.
 * Scaled from the top edge, so the title stays on its line and only the lower part gives.
 */
const settle: Variants = {
  enter: { opacity: 0, scale: 0.98 },
  shown: { opacity: 1, scale: 1, transition: { scale: springs.settle, opacity: { duration: 0.29, ease: ease.out } } },
  leave: { opacity: 0, scale: 0.98, transition: { duration: 0.21, ease: ease.out } },
};
const crossfade: Variants = {
  enter: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.2 } },
  leave: { opacity: 0, transition: { duration: 0.15 } },
};

export function SignInFrame({
  step,
  order,
  lead,
  progress,
  bare = false,
  children,
}: {
  /** The step on show: a change of it slides (or dissolves, to or from a `bare` one). */
  step: string;
  /** Its place in the flow: higher than the last one slides forward, lower slides back. */
  order: number;
  lead: Lead;
  /** [current, count] for the dashes; null for none. */
  progress: readonly [number, number] | null;
  /** The opening: no bar, its own buttons. */
  bare?: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const wide = useWideSignIn();
  const last = useRef({ order, bare });
  const turn: Turn = { dir: order >= last.current.order ? 1 : -1, dissolve: bare || last.current.bare };
  useEffect(() => {
    last.current = { order, bare };
  }, [order, bare]);

  const [primary, setPrimary] = useState<(Omit<PrimaryAction, "onPress"> & { owner: string }) | null>(null);
  const press = useRef<() => void>(() => {});
  const current = useRef(step);
  current.current = step;
  const set = useCallback((owner: string, p: PrimaryAction | null) => {
    if (owner !== current.current) return;
    if (p) press.current = p.onPress;
    setPrimary((cur) => {
      if (!p) return cur?.owner === owner ? null : cur;
      const same = cur && cur.owner === owner && cur.label === p.label && cur.enabled === p.enabled && !!cur.busy === !!p.busy;
      return same ? cur : { owner, label: p.label, enabled: p.enabled, busy: p.busy };
    });
  }, []);
  const footer = !wide && !bare && primary?.owner === step ? primary : null;

  const hand = useRef<Hand | null>(null);
  // The morph is the phone's; wide, the step changes all in one (`settle`).
  const wideRef = useRef(wide);
  wideRef.current = wide;
  const handoff = useRef({
    give: (from: HTMLElement) => {
      if (wideRef.current) return;
      const cs = getComputedStyle(from);
      hand.current = {
        rect: from.getBoundingClientRect(),
        label: from.textContent ?? "",
        bg: cs.backgroundColor,
        fg: cs.color,
        radius: cs.borderRadius,
        at: performance.now(),
      };
      // It's the one that travels: it leaves its place in the dissolving step at once.
      from.style.visibility = "hidden";
    },
    // Only just after the press: a button that appears later (the next step's, a re-render) doesn't fly in.
    take: () => (hand.current && performance.now() - hand.current.at < 400 ? hand.current : null),
    done: () => void (hand.current = null),
  }).current;

  return (
    <Handoff.Provider value={handoff}>
      <div className="si" data-step={step} data-wide={wide || undefined}>
        {wide && <SignInMark className="si-wide-mark" />}
        {/* The bar's room is kept on the opening too, so every step starts at the same height. */}
        <header className="si-bar" data-empty={bare || undefined}>
          <span className="si-bar-lead">
            <AnimatePresence initial={false} mode="popLayout">
              {lead && (
                <motion.button
                  key={lead.icon}
                  type="button"
                  className="si-icon-btn"
                  aria-label={lead.label}
                  onClick={lead.onPress}
                  initial={{ opacity: 0, rotate: lead.icon === "back" ? -60 : 60 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                >
                  {lead.icon === "close" ? <CloseGlyph /> : <BackGlyph />}
                </motion.button>
              )}
            </AnimatePresence>
          </span>
          <Progress at={progress?.[0] ?? -1} of={progress?.[1] ?? 0} />
          {!bare && <Help />}
        </header>
        <div className="si-stage">
          <AnimatePresence initial={false} mode={wide ? "wait" : "popLayout"} custom={turn}>
            <motion.div
              key={step}
              className="si-step"
              style={wide ? { transformOrigin: "50% 0%" } : undefined}
              custom={turn}
              variants={reduce ? crossfade : wide ? settle : steps}
              initial="enter"
              animate="shown"
              exit="leave"
            >
              <PrimarySlot.Provider value={{ owner: step, inline: wide, set }}>{children}</PrimarySlot.Provider>
            </motion.div>
          </AnimatePresence>
        </div>
        {!wide && (
          <footer className="si-foot" data-empty={bare || undefined}>
            {footer && <PrimaryButton key={footer.owner} {...footer} onPress={() => press.current()} />}
          </footer>
        )}
      </div>
    </Handoff.Provider>
  );
}

/** How far along: a dash per step, the current one long and lit; the light runs on to the next. */
function Progress({ at, of }: { at: number; of: number }) {
  if (of < 1) return <span className="si-progress" />;
  return (
    <span className="si-progress" role="progressbar" aria-label="Sign-in progress" aria-valuemin={1} aria-valuemax={of} aria-valuenow={at + 1}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} data-on={i === at || undefined} />
      ))}
    </span>
  );
}

function Help() {
  return (
    <PopoverRoot>
      <PopoverTrigger className="si-icon-btn" aria-label="About signing in">
        <HelpGlyph />
      </PopoverTrigger>
      <PopoverPopup className="si-help" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
        <p>
          <strong>Why sign in?</strong> An account keeps your profiles, library, watch history and settings in sync across your
          devices.
        </p>
        <p>There's no password: each time, we email you a six-digit code. New here? Signing in makes your account.</p>
      </PopoverPopup>
    </PopoverRoot>
  );
}

/**
 * An account error's `code` (AccountError's), read off the error rather than by `instanceof`: in a dev server the class
 * can be loaded twice (a module reloaded under a new URL), and the check would then miss a refused code.
 */
export function errorCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

/**
 * A refused code, as Family says it: a red pill that pops up under the code (and goes as the next code is typed,
 * when the code's ring turns back from red too). Its room is kept, so nothing under it moves.
 */
export function WrongCode({ show }: { show: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="si-wrong-slot" aria-live="assertive">
      <AnimatePresence initial={false}>
        {show && (
          <motion.p
            key="wrong"
            className="si-wrong"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: reduce ? { duration: 0.15 } : { type: "spring", bounce: 0.45, duration: 0.42 } }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
          >
            Oops! That’s incorrect.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A refusal or a problem, under the step's field. */
export function ErrorLine({ error, action }: { error: { message: string } | null; action?: ReactNode }) {
  if (!error) return null;
  return (
    <div className="auth-error si-error" role="alert">
      <span>{error.message}</span>
      {action}
    </div>
  );
}

const CloseGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const BackGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
    <path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const HelpGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
    <circle cx="11" cy="11" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8.6 8.7a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="11" cy="15.4" r="1" fill="currentColor" />
  </svg>
);
