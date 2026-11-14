import { useEffect, useState } from "react";
import type { Profile } from "../../lib/account/backend";
import { waitLeft, triesOf, waitText } from "../../lib/account/pinTries";
import { checkPin, type PinAnswer, type PinRequest } from "../../lib/account/unlock";
import { Avatar } from "../Avatar";
import { AccountCheck } from "./AccountCheck";
import { PinPad } from "./PinPad";

/**
 * What a PIN prompt asks (lib/account/unlock.ts `PinRequest`): a profile's PIN (whose, first, when several
 * could do), a new PIN typed twice, or the account itself. The dialog around it is PinHost's.
 */
export function PinFlow({ request, onDone }: { request: PinRequest; onDone: (answer: PinAnswer) => void }) {
  switch (request.kind) {
    case "check":
      return <CheckPin request={request} onDone={onDone} />;
    case "new":
      return <NewPin onDone={onDone} />;
    case "account":
      return <AccountCheck reauth={request.reauth} onDone={() => onDone(true)} />;
  }
}

/** Ticks while a wait runs, so the time left stays current. */
function useWait(profile: Profile | null) {
  const [now, setNow] = useState(() => Date.now());
  const left = profile ? waitLeft(triesOf(profile.id), now) : 0;
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(left, 1000));
    return () => clearTimeout(id);
  }, [left, now]);
  return { left, refresh: () => setNow(Date.now()) };
}

function CheckPin({ request, onDone }: { request: Extract<PinRequest, { kind: "check" }>; onDone: (a: PinAnswer) => void }) {
  const [whose, setWhose] = useState<Profile | null>(request.profiles.length === 1 ? request.profiles[0] : null);
  const [forgot, setForgot] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const wait = useWait(whose);

  if (forgot && request.forgot) {
    return (
      <>
        <p className="pin-text">Forgot the PIN? Confirm it's your account and the PIN is removed.</p>
        <AccountCheck reauth={request.forgot} onDone={() => onDone("account")} />
      </>
    );
  }

  if (!whose) {
    return (
      <div className="pin-whose">
        <p className="pin-text">Whose PIN?</p>
        <div className="pin-whose-list">
          {request.profiles.map((p) => (
            <button key={p.id} type="button" className="pin-whose-profile pressable" onClick={() => setWhose(p)}>
              <Avatar id={p.avatar} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const enter = async (pin: string) => {
    setChecking(true);
    const result = await checkPin(whose, pin);
    setChecking(false);
    if (result.ok) return onDone({ profile: whose.id, pin });
    setWrong(true);
    wait.refresh();
  };

  return (
    <>
      {request.profiles.length > 1 && (
        <button type="button" className="pin-whose-current pressable" onClick={() => (setWhose(null), setWrong(false))}>
          <Avatar id={whose.avatar} />
          <span>{whose.name}</span>
        </button>
      )}
      <PinPad label="PIN" onComplete={(pin) => void enter(pin)} disabled={checking || wait.left > 0} />
      <p className="pin-error" role="alert">
        {wait.left > 0 ? `Too many wrong PINs. ${waitText(wait.left)}` : wrong ? "That PIN isn't right." : ""}
      </p>
      {request.forgot && (
        <button type="button" className="auth-link" onClick={() => setForgot(true)}>
          Forgot PIN?
        </button>
      )}
    </>
  );
}

function NewPin({ onDone }: { onDone: (a: PinAnswer) => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  return (
    <>
      <p className="pin-text">{first ? "Enter it again." : "Enter a new PIN."}</p>
      <PinPad
        key={first ? "again" : "first"}
        label={first ? "PIN again" : "New PIN"}
        onComplete={(pin) => {
          if (!first) return (setFirst(pin), setMismatch(false));
          if (pin === first) return onDone({ pin });
          setFirst(null);
          setMismatch(true);
        }}
      />
      <p className="pin-error" role="alert">
        {mismatch ? "Those didn't match. Start again." : ""}
      </p>
    </>
  );
}
