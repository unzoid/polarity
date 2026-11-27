import { useState } from "react";
import { CodeInput } from "../../components/ui/CodeInput";
import { isTwoStepCode, TWO_STEP_CODE_LENGTH, useAccount } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import { AccountShell } from "./AccountShell";
import { ErrorLine, errorCode, SignInFrame, WrongCode } from "./SignInFrame";

/**
 * Signing in, second step: the email code was right, and the account has two-step sign-in on, so a
 * code from an authenticator app comes before anything is signed in (AccountProvider's `twoStep`).
 * One authenticator is asked; "Use another authenticator" picks one of the others.
 *
 * `TwoStepBody` is a step of AuthScreen's SignInFrame (so the top badge morphs from mail to lock);
 * `TwoStepScreen` gives it a frame of its own for standalone rendering.
 */
export function TwoStepScreen() {
  const account = useAccount();
  return (
    <AccountShell plain>
      <SignInFrame step="two-step" badge="lock" lead={{ label: "Back to sign in", onPress: () => void account.cancelTwoStep() }}>
        <TwoStepBody />
      </SignInFrame>
    </AccountShell>
  );
}

export function TwoStepBody() {
  const account = useAccount();
  const authenticators = account.twoStep ?? [];
  const [pick, setPick] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [code, setCode] = useState("");
  const [refused, setRefused] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = authenticators[Math.min(pick, authenticators.length - 1)];

  const verify = async (value: string) => {
    if (!current || busy) return;
    if (!isTwoStepCode(value)) return setError(`Enter the ${TWO_STEP_CODE_LENGTH}-digit code from your authenticator app.`);
    setBusy(true);
    setError(null);
    try {
      await account.verifyTwoStep(current.id, value);
    } catch (e) {
      // A wrong code: the cells shake and empty, the ring turns red, the badge says so. Anything else, in words.
      if (errorCode(e) === "invalid_code") setWrong(true);
      else setError(errorMessage(e));
      setRefused((n) => n + 1);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (choosing)
    return (
      <div className="si-step-body">
        <h1 className="si-title">Use Another Authenticator</h1>
        <p className="si-sub">Pick the app you&apos;ll get the code from.</p>
        <div className="si-choices">
          {authenticators.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className="si-choice"
              aria-current={i === pick || undefined}
              onClick={() => (setPick(i), setChoosing(false), setCode(""), setError(null))}
            >
              {a.name}
            </button>
          ))}
        </div>
        <button type="button" className="si-text-link" onClick={() => setChoosing(false)}>
          Back
        </button>
      </div>
    );

  return (
    <form
      className="si-step-body"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      noValidate
    >
      <h1 className="si-title">Two-Step Sign-In</h1>
      <p className="si-sub">
        Enter the {TWO_STEP_CODE_LENGTH}-digit code from your authenticator app
        {authenticators.length > 1 && current ? (
          <>
            {" "}
            (<strong>{current.name}</strong>)
          </>
        ) : null}
        .
      </p>
      <div className="si-code">
        <CodeInput
          aria-label="Authenticator code"
          length={TWO_STEP_CODE_LENGTH}
          value={code}
          onChange={(v) => (setCode(v), setError(null), setWrong(false))}
          onComplete={(v) => void verify(v)}
          errorKey={refused}
          disabled={busy}
          autoFocus
        />
      </div>
      {authenticators.length > 1 && (
        <p className="si-resend">
          <button type="button" onClick={() => setChoosing(true)}>
            Use another authenticator
          </button>
        </p>
      )}
      <WrongCode show={wrong} />
      <ErrorLine error={error ? { message: error } : null} />
      <button type="submit" hidden />
    </form>
  );
}
