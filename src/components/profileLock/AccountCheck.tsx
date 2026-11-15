import { useState, type FormEvent } from "react";
import { AccountError } from "../../lib/account/backend";
import type { Reauth } from "../../lib/account/unlock";
import { errorMessage } from "../../lib/errors";
import { Captcha } from "../../screens/account/Captcha";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";

/**
 * Confirming it's the account's owner on a device already signed in (AccountBackend.reauth): a code sent to the
 * account's email, typed here. `onDone` once it's checked.
 */
export function AccountCheck({ reauth, onDone }: { reauth: Reauth; onDone: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      if (e instanceof AccountError && e.code === "captcha_needed") setCaptcha(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = (token?: string) =>
    run(
      () => reauth.start(token),
      () => (setSent(true), setCaptcha(false)),
    );
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) void run(() => reauth.verify(code.trim()), onDone);
  };

  return (
    <div className="pin-account">
      {!sent ? (
        <>
          <p className="pin-text">
            A code goes to <strong>{reauth.email}</strong>, as when signing in.
          </p>
          {captcha && <Captcha onToken={(t) => void send(t)} />}
          <Button variant="accent" size="block" busy={busy} disabled={busy} onClick={() => void send()}>
            Send Code
          </Button>
        </>
      ) : (
        <form onSubmit={confirm} className="pin-account-form">
          <p className="pin-text">Enter the code sent to {reauth.email}.</p>
          <TextField
            look="block"
            value={code}
            onChange={setCode}
            aria-label="Code from the email"
            placeholder="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <Button variant="accent" size="block" type="submit" busy={busy} disabled={busy || !code.trim()}>
            Confirm
          </Button>
        </form>
      )}
      {error && (
        <p className="pin-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
