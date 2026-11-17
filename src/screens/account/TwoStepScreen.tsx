import { useState } from "react";
import logo from "../../assets/polarity-white.png";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { isTwoStepCode, tidyCode, TWO_STEP_CODE_LENGTH, useAccount } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import { AccountShell } from "./AccountShell";

/**
 * Signing in, second step: the email code was right, and the account has two-step sign-in on, so a
 * code from an authenticator app comes before anything is signed in (AccountProvider's `twoStep`).
 * One authenticator is asked; "Use another authenticator" picks one of the others.
 */
export function TwoStepScreen() {
  const account = useAccount();
  const authenticators = account.twoStep ?? [];
  const [pick, setPick] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = authenticators[Math.min(pick, authenticators.length - 1)];

  const verify = async (value: string) => {
    if (!current) return;
    if (!isTwoStepCode(value)) return setError(`Enter the ${TWO_STEP_CODE_LENGTH}-digit code from your authenticator app.`);
    setBusy(true);
    setError(null);
    try {
      await account.verifyTwoStep(current.id, value);
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountShell plain>
      <div className="auth">
        <img className="auth-mark wordmark" src={logo} alt="Polarity" draggable={false} />
        <div className="auth-body">
          {choosing ? (
            <div className="auth-form">
              <h1 className="auth-title">Use another authenticator</h1>
              <div className="auth-actions">
                {authenticators.map((a, i) => (
                  <Button
                    key={a.id}
                    size="block"
                    variant={i === pick ? "accent" : undefined}
                    onClick={() => (setPick(i), setChoosing(false), setCode(""), setError(null))}
                  >
                    {a.name}
                  </Button>
                ))}
              </div>
              <button type="button" className="auth-link" onClick={() => setChoosing(false)}>
                Back
              </button>
            </div>
          ) : (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                void verify(code);
              }}
              noValidate
            >
              <h1 className="auth-title">Two-step sign-in</h1>
              <p className="auth-sub">
                Enter the {TWO_STEP_CODE_LENGTH}-digit code from your authenticator app
                {authenticators.length > 1 && current ? (
                  <>
                    {" "}
                    (<strong>{current.name}</strong>)
                  </>
                ) : null}
                .
              </p>
              <div className="auth-actions">
                <TextField
                  look="block"
                  aria-label="Authenticator code"
                  className="auth-code"
                  placeholder="Enter code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={TWO_STEP_CODE_LENGTH}
                  value={code}
                  onChange={(v) => {
                    const tidy = tidyCode(v);
                    setCode(tidy);
                    setError(null);
                    if (isTwoStepCode(tidy) && !busy) void verify(tidy);
                  }}
                  autoFocus
                />
                <Button variant="accent" size="block" type="submit" disabled={busy || !code} busy={busy}>
                  Continue
                </Button>
              </div>
              {error && (
                <div className="auth-error" role="alert">
                  <span>{error}</span>
                </div>
              )}
              {authenticators.length > 1 && (
                <button type="button" className="auth-link" onClick={() => setChoosing(true)}>
                  Use another authenticator
                </button>
              )}
              <button type="button" className="auth-link" onClick={() => void account.cancelTwoStep()}>
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </AccountShell>
  );
}
