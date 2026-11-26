import { useContext, useState, type ReactNode } from "react";
import { AccountContext, secretsState, setSecretsPassphrase, sync } from "../../lib/account";
import { useFormFactor } from "../../lib/ui";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { FamilyTray, FamilyWarningIcon } from "./FamilyTray";
import { FormRow } from "./rows";
import { showWhereStored } from "./secretsNote";

/** What is about to be saved: one key, several, or an add-on link that holds a key. */
export type KeyKind = "key" | "keys" | "link";

const HEADLINE: Record<KeyKind, string> = {
  key: "This key will be stored on your account unencrypted.",
  keys: "These keys will be stored on your account unencrypted.",
  link: "This add-on link contains a key. It will be stored on your account unencrypted.",
};

const TRAY_TITLE: Record<KeyKind, string> = {
  key: "Unencrypted Key",
  keys: "Unencrypted Keys",
  link: "Unencrypted Link",
};

/** True while a signed-in profile's keys and add-on links sync readable (no passphrase). */
export function useSecretsPlain(): boolean {
  const account = useContext(AccountContext);
  return account?.status === "ready" && !!account.profile && secretsState(account.profile.id) === "plain";
}

/**
 * Asks before a new key or keyed add-on link is saved on a signed-in profile without a passphrase
 * (#195): `guard(kind, save)` saves straight away otherwise. Draw `warning` under the form; it offers
 * a passphrase right there, saving anyway, or not saving.
 */
export function useKeyGate(): { guard: (kind: KeyKind | null, save: () => void) => void; warning: ReactNode } {
  const account = useContext(AccountContext);
  const plain = useSecretsPlain();
  const [asking, setAsking] = useState<{ kind: KeyKind; save: () => void } | null>(null);
  const guard = (kind: KeyKind | null, save: () => void) => {
    if (kind && plain) setAsking({ kind, save });
    else {
      setAsking(null);
      save();
    }
  };
  const profileId = account?.status === "ready" ? account.profile?.id : undefined;
  const warning =
    asking && profileId ? (
      <KeyWarning
        kind={asking.kind}
        onPassphrase={(phrase) => {
          setSecretsPassphrase(profileId, phrase);
          setAsking(null);
          asking.save();
          void sync.flush().catch(() => {});
        }}
        onSave={() => {
          setAsking(null);
          asking.save();
        }}
        onCancel={() => setAsking(null)}
      />
    ) : null;
  return { guard, warning };
}

function KeyWarning({
  kind,
  onPassphrase,
  onSave,
  onCancel,
}: {
  kind: KeyKind;
  onPassphrase: (phrase: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const phone = useFormFactor().form === "phone";
  const [typing, setTyping] = useState(false);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [phrase, setPhrase] = useState("");

  if (phone) {
    return (
      <FamilyTray
        open
        onClose={onCancel}
        title={typing ? "Set a Passphrase" : TRAY_TITLE[kind]}
        heroIcon={typing ? undefined : <FamilyWarningIcon size={36} className="ft-warn-ico" />}
        stepKey={typing ? "passphrase" : `warn-${kind}`}
        direction={dir}
        onBack={
          typing
            ? () => {
                setDir("back");
                setTyping(false);
              }
            : undefined
        }
      >
        {typing ? (
          <form
            className="ft-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (phrase) onPassphrase(phrase);
            }}
          >
            <p className="ft-desc">
              Each of your devices asks for it once. Nobody can get it back if it's forgotten; then you'd enter your keys and add-ons again.
            </p>
            <TextField
              type="password"
              placeholder="Passphrase"
              aria-label="Passphrase"
              autoComplete="new-password"
              autoFocus
              value={phrase}
              onChange={setPhrase}
            />
            <div className="ft-actions">
              <button type="submit" className="ft-pill ft-pill-cta" disabled={!phrase}>
                Set and Save
              </button>
            </div>
          </form>
        ) : (
          <div className="ft-key-warn" role="alert" data-kind={kind}>
            <p className="ft-desc">
              {HEADLINE[kind]} Anyone with access to the account server could read it.{" "}
              <button type="button" className="ft-inline-link" onClick={showWhereStored}>
                What's stored where
              </button>
            </p>
            <div className="ft-key-warn-actions">
              <button
                type="button"
                className="ft-pill ft-pill-cta"
                onClick={() => {
                  setDir("forward");
                  setTyping(true);
                }}
              >
                Set a Passphrase
              </button>
              <div className="ft-actions">
                <button type="button" className="ft-pill ft-pill-secondary" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="ft-pill ft-pill-danger" onClick={onSave}>
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </FamilyTray>
    );
  }

  return (
    <div className="settings-key-warning" role="alert" data-kind={kind}>
      <p className="settings-expand-text">
        <strong>{HEADLINE[kind]}</strong> Anyone with access to the account server could read it. Set a passphrase to encrypt it.
      </p>
      {typing ? (
        <>
          <p className="settings-expand-text">
            Each of your devices asks for it once. Nobody can get it back if it's forgotten; then you'd enter your keys and add-ons again.
          </p>
          <FormRow
            look="expand"
            type="password"
            placeholder="Passphrase"
            aria-label="Passphrase"
            autoComplete="new-password"
            autoFocus
            value={phrase}
            onChange={setPhrase}
            tidy={(v) => v}
            submit="Set and Save"
            onSubmit={onPassphrase}
          />
          <div className="settings-expand-form">
            <Button onClick={() => setTyping(false)}>Back</Button>
          </div>
        </>
      ) : (
        <div className="settings-expand-form">
          <Button variant="primary" onClick={() => setTyping(true)}>
            Set a Passphrase
          </Button>
          <Button onClick={onSave}>Save Anyway</Button>
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      <p className="settings-expand-text">
        <button type="button" className="settings-link" onClick={showWhereStored}>
          What's stored where
        </button>
      </p>
    </div>
  );
}
