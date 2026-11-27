import "../../styles/signin.css";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { ease, springs } from "../../lib/ui";
import { SignInMark } from "./SignInMark";

/**
 * The sign-in's frame: a single centred column on a flat page, with Linear's `settle` transition
 * between steps (the whole step — badge, heading, field — fades out with a barely-there sink to
 * 98%, then the next settles into place on `springs.settle` from the top edge), a quiet top-left
 * back chevron on later steps, and a calm footer pinned to the foot of the viewport.
 */
export type Lead = { label: string; onPress: () => void } | null;
export type StepBadge = "brand" | "mail" | "lock" | "device" | "passkey";

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
  badge,
  lead,
  secondary,
  footer,
  children,
}: {
  /** The active step key; changing it plays the Linear `settle` transition. */
  step: string;
  /** The logo or circular icon badge shown at the top of the step. */
  badge: StepBadge;
  /** Top-left back chevron; null on the opening step. */
  lead: Lead;
  /** Optional subtle secondary sign-in action above the legal footer. */
  secondary?: ReactNode;
  /** Quiet dot-separated links pinned at the foot of the screen. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="si" data-step={step}>
      <AnimatePresence initial={false}>
        {lead && (
          <motion.button
            key={lead.label}
            type="button"
            className="si-back"
            aria-label={lead.label}
            onClick={lead.onPress}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: ease.out }}
          >
            <BackGlyph />
          </motion.button>
        )}
      </AnimatePresence>

      <div className="si-center">
        <div className="si-stage">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={step}
              className="si-step"
              style={{ transformOrigin: "50% 0%" }}
              variants={reduce ? crossfade : settle}
              initial="enter"
              animate="shown"
              exit="leave"
            >
              <div className="si-badge-slot">
                <div className={badge === "brand" ? "si-badge si-badge-brand" : "si-badge si-badge-circle"}>
                  <BadgeIcon kind={badge} />
                </div>
              </div>
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <footer className="si-bottom">
        <AnimatePresence initial={false}>
          {secondary && (
            <motion.div
              key="secondary"
              className="si-secondary-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: ease.out }}
            >
              {secondary}
            </motion.div>
          )}
        </AnimatePresence>
        {footer}
      </footer>
    </div>
  );
}

/**
 * Full-width rounded accent action button matching Aave Account's vertical slot-roll transition:
 * when busy, the label rolls down and fades out while the centred spinner drops in from above.
 */
export function ActionButton({
  label,
  busy = false,
  disabled = false,
  type = "button",
  onPress,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  onPress?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type={type}
      className="si-primary"
      disabled={disabled || busy}
      data-busy={busy || undefined}
      onClick={onPress}
    >
      <AnimatePresence initial={false}>
        {busy ? (
          <motion.span
            key="spin"
            className="si-primary-layer"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
            transition={{ duration: 0.15, ease: ease.out }}
          >
            <Spin size={18} />
          </motion.span>
        ) : (
          <motion.span
            key="label"
            className="si-primary-layer"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.15, ease: ease.out }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** Smooth circular quarter-arc spinner, centred inside the action button while busy. */
export function Spin({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg className={className ? `si-spin ${className}` : "si-spin"} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.8" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
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
 * A refused code: a red pill that pops up under the code (and clears as the next digit is typed,
 * when the code's ring turns back from red too). Its room is kept so nothing around it shifts.
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
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: reduce ? { duration: 0.15 } : { type: "spring", bounce: 0.4, duration: 0.4 } }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
          >
            Oops! That’s incorrect.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A refusal or a problem, centred under the step's field. */
export function ErrorLine({ error, action }: { error: { message: string } | null; action?: ReactNode }) {
  if (!error) return null;
  return (
    <div className="auth-error si-error" role="alert">
      <span>{error.message}</span>
      {action}
    </div>
  );
}

function BadgeIcon({ kind }: { kind: StepBadge }) {
  switch (kind) {
    case "brand":
      return <SignInMark />;
    case "mail":
      return <MailGlyph />;
    case "lock":
      return <LockGlyph />;
    case "device":
      return <DeviceGlyph />;
    case "passkey":
      return <PasskeyGlyph />;
  }
}

const BackGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MailGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="5.25" width="18" height="13.5" rx="3.25" stroke="currentColor" strokeWidth="1.9" />
    <path d="M4.25 7.5l6.65 4.6a1.9 1.9 0 0 0 2.2 0l6.65-4.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="5" y="10.5" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.9" />
    <path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <circle cx="12" cy="15.5" r="1.25" fill="currentColor" />
  </svg>
);

export const DeviceGlyph = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2.75" stroke="currentColor" strokeWidth="1.9" />
    <path d="M8.5 20h7M12 17v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

export const PasskeyGlyph = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="9.25" cy="7.75" r="3.25" stroke="currentColor" strokeWidth="1.85" />
    <path d="M3.5 18.75c0-2.9 2.55-4.75 5.75-4.75 1.15 0 2.2.25 3.05.7" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    <circle cx="17.25" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.85" />
    <path d="M17.25 14.25v5.25M17.25 17.5h2" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
