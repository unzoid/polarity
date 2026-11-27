import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { CodeInput } from "../../components/ui/CodeInput";
import { formatTvCode, useAccount, type TvSignInRequest } from "../../lib/account";
import { api } from "../../lib/api";
import { inShell } from "../../lib/platform/bridge";
import { errorMessage } from "../../lib/errors";
import { PRIVACY_URL, TERMS_URL } from "../../lib/settings/catalog";
import { ease } from "../../lib/ui";
import { useTvMode } from "../../tv/tvMode";
import { AccountShell } from "./AccountShell";
import { Captcha } from "./Captcha";
import { ActionButton, DeviceGlyph, ErrorLine, errorCode, PasskeyGlyph, SignInFrame, WrongCode, type Lead, type StepBadge } from "./SignInFrame";
import { TvSignInQr } from "./TvSignInQr";
import { TwoStepBody } from "./TwoStepScreen";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The server only sends a new code once a minute. */
const RESEND_AFTER_S = 60;
/** The email's code (Supabase's email OTP, six digits: docs/supabase-storage.md). */
const CODE_LENGTH = 6;

type Failure = { message: string; signedIn?: boolean };
type Step = "start" | "email" | "code" | "device";
type Active = Step | "two-step" | "passkey";

const BADGE: Record<Active, StepBadge> = {
  start: "brand",
  email: "brand",
  code: "mail",
  device: "device",
  "two-step": "lock",
  passkey: "passkey",
};

/**
 * Passwordless sign-in, modelled on Aave Account: opens straight on the centred email input
 * (TV mode still offers phone sign-in first because typing with a remote is slow). Typing a valid
 * email swaps the helper note for a Continue button in place; submitting morphs the top mark into
 * a soft envelope badge and reveals the 6-digit OTP input, which verifies automatically on the
 * last digit. New emails get an account automatically.
 */
export function AuthScreen() {
  const account = useAccount();
  const tv = useTvMode();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>(() => (tv ? "start" : "email"));
  const [deviceFrom, setDeviceFrom] = useState<Step>(() => (tv ? "start" : "email"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Bumped when the server refuses a code: the cells shake and empty.
  const [refused, setRefused] = useState(0);
  // The last code was refused, until a digit of the next is typed.
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  // Each time the server asks for a CAPTCHA (#110) a fresh one: a token works once.
  const [captcha, setCaptcha] = useState(0);
  const [captchaFor, setCaptchaFor] = useState<"email" | "passkey">("email");
  const wait = useCountdown(sentAt, RESEND_AFTER_S);

  useEffect(() => {
    return () => {
      if (inShell) void api.passkeyHandoffCancel().catch(() => {});
    };
  }, []);

  const go = (s: Step) => {
    setError(null);
    setCaptcha(0);
    setWrong(false);
    if (s === "device") setDeviceFrom(step);
    setStep(s);
  };

  const attempt = async (fn: () => Promise<void>, { signedIn = false, ignoreCancel = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (ignoreCancel && errorCode(e) === "cancelled") return;
      const isCodeError = errorCode(e) === "invalid_code" || errorCode(e) === "invalid_email";
      if (errorCode(e) === "invalid_code" && step === "code") {
        // A wrong code: the cells shake and empty, the ring turns red, the badge says so (no error line).
        setRefused((n) => n + 1);
        setCode("");
        setWrong(true);
        return;
      }
      setError({
        message: errorMessage(e),
        // A code was accepted but setting up profiles failed: retrying the
        // same code won't work, but resuming the session will.
        signedIn: signedIn && !isCodeError,
      });
    } finally {
      setBusy(false);
    }
  };

  const send = (captchaToken?: string) =>
    attempt(async () => {
      try {
        await account.sendCode(email.trim(), captchaToken);
      } catch (e) {
        if (errorCode(e) !== "captcha_needed") throw e;
        setCaptchaFor("email");
        setCaptcha((n) => n + 1);
        return;
      }
      setCaptcha(0);
      setSentAt(Date.now());
      setCode("");
      if (step !== "code") go("code");
    });

  const signInPasskey = (captchaToken?: string) =>
    attempt(
      async () => {
        try {
          await account.signInWithPasskey(captchaToken);
        } catch (e) {
          if (errorCode(e) !== "captcha_needed") throw e;
          setCaptchaFor("passkey");
          setCaptcha((n) => n + 1);
          return;
        }
        setCaptcha(0);
      },
      { signedIn: true, ignoreCancel: true },
    );

  const emailOk = EMAIL_RE.test(email.trim());
  const submitEmail = (e?: FormEvent) => {
    e?.preventDefault();
    if (!emailOk) return setError({ message: "Enter a valid email address." });
    if (!busy) void send();
  };

  const verify = (value: string) => {
    if (value.length < CODE_LENGTH) return setError({ message: "Enter the code from the email." });
    if (!busy) void attempt(() => account.verifyCode(email.trim(), value), { signedIn: true });
  };

  const skip = account.canCancelSignIn ? account.cancelSignIn : account.continueAsGuest;
  const skipLabel = account.canCancelSignIn ? "Cancel" : "Continue Without an Account";
  const active: Active = account.passkeyPrompt ? "passkey" : account.twoStep ? "two-step" : step;

  const lead: Lead =
    active === "code"
      ? { label: "Back", onPress: () => go("email") }
      : active === "device"
        ? { label: "Back", onPress: () => go(deviceFrom) }
        : active === "two-step"
          ? { label: "Back to sign in", onPress: () => void account.cancelTwoStep() }
          : active === "email" && tv
            ? { label: "Back", onPress: () => go("start") }
            : null;

  const secondary =
    active === "email" && !tv ? (
      <div className="si-alt-row">
        {account.passkeysSupported && (
          <button type="button" className="si-alt-btn" onClick={() => void signInPasskey()} disabled={busy}>
            <PasskeyGlyph size={15} />
            <span>Sign In with Passkey</span>
          </button>
        )}
        <button type="button" className="si-alt-btn" onClick={() => go("device")} disabled={busy}>
          <DeviceGlyph size={15} />
          <span>Sign In with Another Device</span>
        </button>
      </div>
    ) : null;

  const footer =
    active !== "two-step" ? (
      <div className="si-footer">
        {!tv && active !== "passkey" && (
          <>
            <button type="button" onClick={skip}>
              {skipLabel}
            </button>
            <span className="si-footer-dot" aria-hidden>
              ·
            </span>
          </>
        )}
        <button type="button" onClick={() => void api.openExternal(PRIVACY_URL)}>
          Privacy
        </button>
        <span className="si-footer-dot" aria-hidden>
          ·
        </span>
        <button type="button" onClick={() => void api.openExternal(TERMS_URL)}>
          Terms
        </button>
      </div>
    ) : null;

  return (
    <AccountShell plain>
      <SignInFrame step={active} badge={BADGE[active]} lead={lead} secondary={secondary} footer={footer}>
        {active === "two-step" && <TwoStepBody />}

        {active === "passkey" && (
          <PasskeySetupStep
            busy={busy}
            error={error}
            onAdd={() => void attempt(() => account.addPasskey(), { ignoreCancel: true })}
            onSkip={() => {
              if (inShell) void api.passkeyHandoffCancel().catch(() => {});
              void attempt(() => account.skipPasskeySetup());
            }}
          />
        )}

        {active === "start" && (
          <TvStartStep
            onDevice={() => go("device")}
            onEmail={() => go("email")}
            onSkip={skip}
            skipLabel={skipLabel}
          />
        )}

        {active === "email" && (
          <form className="si-step-body" onSubmit={submitEmail} noValidate>
            <h1 className="si-title">Welcome to Polarity</h1>
            <p className="si-sub">Sign in or sign up to get started.</p>
            <div className="si-input-wrap" data-busy={busy || undefined}>
              <input
                className="si-input"
                aria-label="Email address"
                type="email"
                autoComplete="username webauthn"
                placeholder="Email Address"
                spellCheck={false}
                autoCapitalize="off"
                value={email}
                disabled={busy}
                onChange={(e) => (setEmail(e.target.value), setError(null))}
                autoFocus
              />
            </div>
            <div className="si-action-slot">
              <AnimatePresence initial={false}>
                {emailOk ? (
                  <motion.div
                    key="continue"
                    className="si-action-layer"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: reduce
                        ? { duration: 0.14 }
                        : {
                            y: { type: "spring", bounce: 0, duration: 0.32 },
                            scale: { type: "spring", bounce: 0, duration: 0.32 },
                            opacity: { duration: 0.18, ease: ease.out },
                          },
                    }}
                    exit={
                      reduce
                        ? { opacity: 0, transition: { duration: 0.12 } }
                        : { opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.18, ease: ease.out } }
                    }
                  >
                    <ActionButton type="submit" label="Continue" busy={busy} />
                  </motion.div>
                ) : (
                  <motion.p
                    key="hint"
                    className="si-action-layer si-hint"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: ease.out } }}
                    exit={
                      reduce
                        ? { opacity: 0, transition: { duration: 0.12 } }
                        : { opacity: 0, y: -10, transition: { duration: 0.16, ease: ease.out } }
                    }
                  >
                    We&apos;ll create an account if you don&apos;t have one yet.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            {!emailOk && <button type="submit" hidden />}
            {captcha > 0 && <Captcha key={captcha} onToken={(t) => void (captchaFor === "passkey" ? signInPasskey(t) : send(t))} />}
            <ErrorLine error={error} />
          </form>
        )}

        {active === "code" && (
          <form
            className="si-step-body"
            onSubmit={(e) => {
              e.preventDefault();
              verify(code);
            }}
            noValidate
          >
            <h1 className="si-title">We&apos;ve emailed you a verification code</h1>
            <p className="si-sub">
              Please enter the code we sent to <strong>{email.trim()}</strong>.
            </p>
            <div className="si-code">
              <CodeInput
                aria-label="Verification code"
                length={CODE_LENGTH}
                value={code}
                onChange={(v) => (setCode(v), setError(null), setWrong(false))}
                onComplete={verify}
                errorKey={refused}
                disabled={busy}
                autoFocus
              />
            </div>
            <p className="si-resend">
              Didn&apos;t receive a code?{" "}
              {wait > 0 ? (
                <span className="tabular">Resend in {wait}s</span>
              ) : (
                <button type="button" onClick={() => void send()} disabled={busy}>
                  Resend
                </button>
              )}
            </p>
            <WrongCode show={wrong} />
            {captcha > 0 && <Captcha key={captcha} onToken={(t) => void send(t)} />}
            <ErrorLine
              error={error}
              action={
                error?.signedIn ? (
                  <button type="button" className="auth-link" onClick={() => void attempt(account.resume)}>
                    Try again
                  </button>
                ) : null
              }
            />
            <button type="submit" hidden />
          </form>
        )}

        {active === "device" && <DeviceStep tv={tv} />}
      </SignInFrame>
    </AccountShell>
  );
}

/**
 * Post-login passkey setup prompt (modelled 1:1 on Aave Account): shown right after signing up or
 * signing into an account that has no passkey yet on a WebAuthn-capable device.
 */
function PasskeySetupStep({
  busy,
  error,
  onAdd,
  onSkip,
}: {
  busy: boolean;
  error: Failure | null;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="si-step-body si-passkey">
      <h1 className="si-title">Setup Passkey</h1>
      <p className="si-sub">Passkeys make it easy to login.</p>
      <div className="si-passkey-card">
        <div className="si-passkey-row">
          <span className="si-passkey-ico" aria-hidden>
            <FastGlyph />
          </span>
          <div className="si-passkey-copy">
            <h2>Login Faster</h2>
            <p>Unlike passwords, passkeys don&apos;t need to be remembered.</p>
          </div>
        </div>
        <div className="si-passkey-row">
          <span className="si-passkey-ico" aria-hidden>
            <ShieldCheckGlyph />
          </span>
          <div className="si-passkey-copy">
            <h2>Enhanced Security</h2>
            <p>Passkeys provide the strongest level of protection against phishing.</p>
          </div>
        </div>
        <div className="si-passkey-row">
          <span className="si-passkey-ico" aria-hidden>
            <PhoneGlyph />
          </span>
          <div className="si-passkey-copy">
            <h2>Multi-Device Support</h2>
            <p>Passkeys can be accessed across different devices seamlessly.</p>
          </div>
        </div>
      </div>
      <div className="si-passkey-actions">
        <ActionButton label="Add Passkey" busy={busy} onPress={onAdd} />
      </div>
      <p className="si-resend si-passkey-skip">
        Don&apos;t want to use a passkey?{" "}
        <button type="button" onClick={onSkip}>
          Skip for now
        </button>
      </p>
      <ErrorLine error={error} />
    </div>
  );
}

const FastGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

const ShieldCheckGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3.5l7 2.8v5.2c0 4.65-2.95 7.95-7 9.25-4.05-1.3-7-4.6-7-9.25V6.3l7-2.8z"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
    <path d="M9.25 12.2l1.95 1.95 3.85-3.95" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PhoneGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="6.5" y="3.5" width="11" height="17" rx="3.25" stroke="currentColor" strokeWidth="1.9" />
    <path d="M10.25 6.75h3.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

/**
 * TV opening step: typing an email with a remote is slow, so phone sign-in comes first.
 */
function TvStartStep({
  onDevice,
  onEmail,
  onSkip,
  skipLabel,
}: {
  onDevice: () => void;
  onEmail: () => void;
  onSkip: () => void;
  skipLabel: string;
}) {
  return (
    <div className="si-step-body">
      <h1 className="si-title">Welcome to Polarity</h1>
      <p className="si-sub">Sign in to keep your profiles, watch history and settings on every device.</p>
      <div className="si-start-actions">
        <button type="button" className="si-primary" onClick={onDevice}>
          Sign In with Your Phone
        </button>
        <button type="button" className="si-secondary" onClick={onEmail}>
          Continue with Email
        </button>
        <button type="button" className="si-text-btn" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
    </div>
  );
}

type DeviceState =
  | { kind: "loading" }
  | { kind: "code"; request: TvSignInRequest }
  | { kind: "signing-in" }
  | { kind: "over"; message: string };

/**
 * Signing in from another device (#133): a code to enter on a phone or computer that's signed in,
 * until it's approved (the account then moves on to the profiles), denied or expired.
 */
function DeviceStep({ tv }: { tv: boolean }) {
  const account = useAccount();
  const [state, setState] = useState<DeviceState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const stop = new AbortController();
    setState({ kind: "loading" });
    void (async () => {
      try {
        const request = await account.tvSignIn.start();
        if (stop.signal.aborted) return;
        setState({ kind: "code", request });
        const end = await account.tvSignIn.wait(request, stop.signal);
        if (end === "denied") setState({ kind: "over", message: "The sign-in was denied on the other device." });
        else if (end === "expired") setState({ kind: "over", message: "That code has expired." });
        else if (end === "approved") setState({ kind: "signing-in" });
      } catch (e) {
        if (!stop.signal.aborted) setState({ kind: "over", message: errorMessage(e) });
      }
    })();
    return () => stop.abort();
    // `account` changes as sign-in moves on; one request per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  const left = useLeft(state.kind === "code" ? state.request.expiresAt : 0);
  return (
    <div className="si-step-body">
      <h1 className="si-title">{tv ? "Sign In with Your Phone" : "Sign in with another device"}</h1>
      <p className="si-sub">
        On a signed-in device, open <strong>Settings → Account → Sign in a TV</strong> and enter this code.
      </p>
      <div className="si-device">
        <div className="auth-device-code" aria-live="polite" data-state={state.kind}>
          {state.kind === "code" ? formatTvCode(state.request.code) : state.kind === "signing-in" ? "Signing in…" : state.kind === "loading" ? "········" : ""}
        </div>
        {(state.kind === "code" || state.kind === "loading") && (
          <p className="si-note si-device-wait">
            {state.kind === "code" ? `Waiting for approval · the code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "\u00a0"}
          </p>
        )}
        {state.kind === "loading" && (
          <div className="auth-device-qr" aria-hidden>
            <div className="auth-device-qr-skeleton skeleton" />
            <p className="auth-fine">On an Android phone with Polarity, you can scan this with the camera instead.</p>
          </div>
        )}
        {state.kind === "code" && <TvSignInQr code={state.request.code} />}
        {state.kind === "over" && <ErrorLine error={{ message: state.message }} />}
      </div>
      {state.kind === "over" && (
        <div className="si-device-retry">
          <ActionButton label="Get a New Code" onPress={() => setRound((n) => n + 1)} />
        </div>
      )}
    </div>
  );
}

/** Seconds until `at` (epoch ms), counting down each second; 0 without one. */
function useLeft(at: number) {
  const left = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!at) return;
    const t = window.setInterval(() => setValue(left()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return at ? value : 0;
}

function useCountdown(from: number, seconds: number) {
  const left = () => Math.max(0, Math.ceil(seconds - (Date.now() - from) / 1000));
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!from) return;
    const t = window.setInterval(() => {
      const v = left();
      setValue(v);
      if (v === 0) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, seconds]);
  return from ? value : 0;
}
