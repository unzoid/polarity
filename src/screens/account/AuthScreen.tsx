import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { CodeInput } from "../../components/ui/CodeInput";
import { formatTvCode, useAccount, type TvSignInRequest } from "../../lib/account";
import { useTvMode } from "../../tv/tvMode";
import { api } from "../../lib/api";
import { PRIVACY_URL, TERMS_URL } from "../../lib/settings/catalog";
import { errorMessage } from "../../lib/errors";
import { AccountShell } from "./AccountShell";
import { Captcha } from "./Captcha";
import { ErrorLine, errorCode, Primary, SignInFrame, useHandOff, useWideSignIn, WrongCode, type Lead } from "./SignInFrame";
import { SignInMark } from "./SignInMark";
import { TvSignInQr } from "./TvSignInQr";
import { TwoStepBody } from "./TwoStepScreen";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server only sends a new code once a minute. */
const RESEND_AFTER_S = 60;
/** The email's code (Supabase's email OTP, six digits: docs/supabase-storage.md). */
const CODE_LENGTH = 6;

type Failure = { message: string; signedIn?: boolean };
type Step = "start" | "email" | "code" | "device";
type Active = Step | "two-step";

/** Steps in order, for which way a change slides: forward goes left, back goes right. */
const ORDER: Record<Active, number> = { start: 0, email: 1, device: 2, code: 2, "two-step": 3 };

/**
 * Passwordless sign-in, after Family's: an opening picture with the ways in, then one question per step in
 * SignInFrame (title on the left, the bar across the top, one wide button at the foot). Start → "Your Email" →
 * "Verification Code" (six cells, CodeInput) → signed in; or a code for another device to approve (#133; first on a
 * TV). New emails get an account automatically.
 */
export function AuthScreen() {
  const account = useAccount();
  const [step, setStep] = useState<Step>("start");
  const [deviceFrom, setDeviceFrom] = useState<Step>("start");
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
  const wait = useCountdown(sentAt, RESEND_AFTER_S);
  const tv = useTvMode();

  const go = (s: Step) => {
    setError(null);
    setCaptcha(0);
    if (s === "device") setDeviceFrom(step);
    setStep(s);
  };

  const attempt = async (fn: () => Promise<void>, { signedIn = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
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
        setCaptcha((n) => n + 1);
        return;
      }
      setCaptcha(0);
      setSentAt(Date.now());
      setCode("");
      if (step !== "code") go("code");
    });

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
  const active: Active = account.twoStep ? "two-step" : step;

  // The bar: close on the first question, back after it; how far along.
  const lead: Lead =
    active === "email"
      ? { icon: "close", label: "Close", onPress: () => go("start") }
      : active === "code"
        ? { icon: "back", label: "Back", onPress: () => go("email") }
        : active === "device"
          ? { icon: "back", label: "Back", onPress: () => go(deviceFrom) }
          : active === "two-step"
            ? { icon: "back", label: "Back to sign in", onPress: () => void account.cancelTwoStep() }
            : null;
  const progress = active === "email" ? ([0, 2] as const) : active === "code" ? ([1, 2] as const) : active === "two-step" ? ([2, 3] as const) : null;

  return (
    <AccountShell plain>
      <SignInFrame step={active} order={ORDER[active]} lead={lead} progress={progress} bare={active === "start"}>
        {active === "two-step" && <TwoStepBody />}

        {active === "start" && (
          <StartStep
            tv={tv}
            onEmail={() => go("email")}
            onDevice={() => go("device")}
            onSkip={skip}
            skipLabel={account.canCancelSignIn ? "Cancel" : "Continue Without an Account"}
          />
        )}

        {active === "email" && (
          <form className="si-step-body" onSubmit={submitEmail} noValidate>
            <h1 className="si-title">Your Email</h1>
            <p className="si-sub">Enter your email to sign in, or to make an account if you're new.</p>
            <input
              className="si-input"
              aria-label="Email address"
              type="email"
              autoComplete="email"
              placeholder="Email Address"
              spellCheck={false}
              autoCapitalize="off"
              value={email}
              onChange={(e) => (setEmail(e.target.value), setError(null))}
              autoFocus
            />
            <p className="si-note">Your profiles, library and settings are kept with your account, ready on your other devices.</p>
            {captcha > 0 && <Captcha key={captcha} onToken={(t) => void send(t)} />}
            <ErrorLine error={error} />
            <Primary label="Continue" enabled={emailOk} busy={busy} onPress={() => submitEmail()} />
            {/* Keeps Enter in the field working (the Continue button is an ordinary button). */}
            <button type="submit" hidden />
            <div className="si-or">
              <button type="button" onClick={() => go("device")}>
                or sign in with another device
              </button>
            </div>
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
            <h1 className="si-title">Verification Code</h1>
            <p className="si-sub">
              We've sent a code to <strong>{email.trim()}</strong>.
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
              Didn't receive a code?{" "}
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
            <Primary label="Continue" enabled={code.length === CODE_LENGTH} busy={busy} onPress={() => verify(code)} />
            <button type="submit" hidden />
          </form>
        )}

        {active === "device" && <DeviceStep tv={tv} />}
      </SignInFrame>
    </AccountShell>
  );
}

/**
 * The opening: the wordmark (on a phone; wider, the frame has it over the column), a line about what an account is
 * for, the ways in, the terms. The email button becomes the next step's Continue (useHandOff).
 */
function StartStep({ tv, onEmail, onDevice, onSkip, skipLabel }: { tv: boolean; onEmail: () => void; onDevice: () => void; onSkip: () => void; skipLabel: string }) {
  const wide = useWideSignIn();
  const handOff = useHandOff();
  const email = (e: MouseEvent<HTMLButtonElement>) => {
    handOff(e.currentTarget);
    onEmail();
  };
  // The wordmark says where you are; the heading is for screen readers.
  const copy = (
    <div className="si-start-copy">
      <h1 className="si-sr">Sign in to Polarity</h1>
      <p className="si-start-sub">Sign in to keep your profiles, watch history and settings with you on every device.</p>
    </div>
  );
  return (
    <div className="si-start">
      {/* On a phone the line about accounts sits under the wordmark, in the room above the buttons. */}
      {wide ? (
        copy
      ) : (
        <div className="si-hero">
          <SignInMark />
          {copy}
        </div>
      )}
      <div className="si-start-actions">
        {/* On a TV, typing an email with a remote is the slow way: the phone comes first. */}
        <button type="button" className="si-btn si-btn-light" onClick={tv ? onDevice : email}>
          {tv ? "Sign In with Your Phone" : "Continue with Email"}
        </button>
        <button type="button" className="si-btn si-btn-dark" onClick={tv ? email : onDevice}>
          {tv ? "Continue with Email" : "Sign In with Another Device"}
        </button>
        <button type="button" className="si-btn-text" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
      <p className="si-legal">
        By continuing, you agree to our{" "}
        <button type="button" onClick={() => void api.openExternal(TERMS_URL)}>
          Terms of Use
        </button>{" "}
        and{" "}
        <button type="button" onClick={() => void api.openExternal(PRIVACY_URL)}>
          Privacy Policy
        </button>
        .
      </p>
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
      <h1 className="si-title">{tv ? "Sign In with Your Phone" : "Another Device"}</h1>
      <p className="si-sub">
        On a phone or computer that's signed in to Polarity, open <strong>Settings → Account → Sign in a TV</strong> and enter this
        code.
      </p>
      <div className="si-device">
        <div className="auth-device-code" aria-live="polite" data-state={state.kind}>
          {state.kind === "code" ? formatTvCode(state.request.code) : state.kind === "signing-in" ? "Signing in…" : state.kind === "loading" ? "········" : ""}
        </div>
        {(state.kind === "code" || state.kind === "loading") && (
          <p className="si-note si-device-wait">
            {state.kind === "code" ? `Waiting for approval · the code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : " "}
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
      {state.kind === "over" && <Primary label="Get a New Code" enabled onPress={() => setRound((n) => n + 1)} />}
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
