import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Key, Lock } from "../icons";
import { Button } from "../ui/Button";
import { Card, ExpandRow, FormRow, type Expandable } from "./rows";
import { deviceLabel, groupSecret, isTwoStepCode, tidyCode, tidyEmail, TWO_STEP_CODE_LENGTH, useAccount, type AccountSecurity, type Authenticator, type AuthenticatorSetup } from "../../lib/account";
import { formFactor, isTvDevice, os } from "../../lib/platform";
import { errorMessage } from "../../lib/errors";

const AUTHENTICATORS_KEY = ["account", "authenticators"] as const;
const PASSKEYS_KEY = ["account", "passkeys"] as const;

/**
 * Settings → Account: changing the account's email address, passkeys, and two-step sign-in (lib/account/twoStep.ts).
 * Shown while signed in with a provider; all go through the account's `security`.
 */
export function AccountSecurityCard({ expand }: { expand: (id: string) => Expandable }) {
  const account = useAccount();
  if (!account.security || !account.user) return null;
  return (
    <Card title="Sign-in">
      <EmailRow security={account.security} email={account.user.email} waiting={account.user.newEmail} {...expand("email")} />
      {account.security.passkeys && <PasskeysRow security={account.security} {...expand("passkeys")} />}
      <TwoStepRow security={account.security} {...expand("two-step")} />
    </Card>
  );
}

type EmailStage = { to: string; ask: "new" | "current" };

/**
 * The address and "Change…": the new address, then the code emailed to it (and the one emailed to the
 * current address, when the server asks both). The address shown changes once the server has them.
 */
function EmailRow({ security, email, waiting, ...props }: Expandable & { security: AccountSecurity; email: string; waiting?: string }) {
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<EmailStage | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** "Use another address": the form again, while the server still holds the earlier change until a new one replaces it. */
  const [another, setAnother] = useState(false);
  // A change asked for earlier (or on another device) still waits for its codes.
  const pending = stage ?? (waiting && !another ? { to: waiting, ask: "new" as const } : null);

  // Opened: the address as the server has it now (a change may have been confirmed elsewhere).
  useEffect(() => {
    if (props.open) void security.refreshUser().catch(() => {});
  }, [props.open, security]);

  const change = useMutation({
    mutationFn: async (to: string) => (await security.changeEmail(to), to),
    onSuccess: (to) => (setStage({ to, ask: "new" }), setAnother(false), setCode(""), setDone(null)),
  });
  const confirm = useMutation({
    mutationFn: async ({ at, to, value }: { at: EmailStage; to: string; value: string }) => ({
      at,
      changed: await security.confirmEmailChange(at.ask === "new" ? to : email, to, value),
    }),
    onSuccess: ({ at, changed }) => {
      setCode("");
      if (changed) {
        setStage(null);
        setTyped("");
        setDone(`Your email address is now ${at.to}.`);
      } else setStage({ to: at.to, ask: "current" });
    },
  });

  const submitAddress = (v: string) => {
    const to = tidyEmail(v);
    if (!to) return setProblem("Enter a valid email address.");
    if (to === email.toLowerCase()) return setProblem("That's already your email address.");
    setProblem(null);
    change.mutate(to);
  };

  return (
    <ExpandRow
      setting="email"
      icon={Edit}
      title="Email address"
      caption={pending ? `Waiting for confirmation of ${pending.to}` : email}
      value={pending ? "Waiting" : "Change…"}
      {...props}
    >
      {!pending && (
        <>
          <p className="settings-expand-text">
            You sign in with <strong>{email}</strong>. To change it, enter the new address: a code is emailed there to confirm it.
          </p>
          <FormRow
            look="expand"
            // Not type="email": the browser's own check would stop the form before the app's message.
            inputMode="email"
            aria-label="New email address"
            placeholder="New email address"
            autoComplete="email"
            value={typed}
            onChange={(v) => (setTyped(v), setProblem(null), change.reset())}
            submit="Change"
            pending={change.isPending}
            pendingLabel="Sending…"
            error={problem ?? (change.isError && errorMessage(change.error))}
            onSubmit={submitAddress}
          />
        </>
      )}
      {pending && (
        <>
          <p className="settings-expand-text" role="status">
            {pending.ask === "new" ? (
              <>
                Check <strong>{pending.to}</strong> to confirm, and enter the code from that email. If a code also comes to <strong>{email}</strong>, it's
                asked for next. Until then you keep signing in with {email}.
              </>
            ) : (
              <>
                <strong>{pending.to}</strong> is confirmed. Now enter the code sent to <strong>{email}</strong>, your current address.
              </>
            )}
          </p>
          <FormRow
            look="expand"
            aria-label={`Code sent to ${pending.ask === "new" ? pending.to : email}`}
            placeholder="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onChange={(v) => (setCode(v.replace(/\D/g, "")), confirm.reset())}
            submit="Confirm"
            pending={confirm.isPending}
            pendingLabel="Confirming…"
            error={confirm.isError && errorMessage(confirm.error)}
            onSubmit={(v) => confirm.mutate({ at: pending, to: pending.to, value: v })}
          />
          <div className="settings-expand-form">
            <Button onClick={() => change.mutate(pending.to)} disabled={change.isPending}>
              Send the Code Again
            </Button>
            <Button variant="plain" onClick={() => (setStage(null), setAnother(true), setCode(""), change.reset(), confirm.reset(), setTyped(""))}>
              Use Another Address
            </Button>
          </div>
          {change.isError && <p className="settings-error">{errorMessage(change.error)}</p>}
        </>
      )}
      {done && (
        <p className="settings-expand-text" role="status">
          {done}
        </p>
      )}
    </ExpandRow>
  );
}

type TwoStepAction = { kind: "add" } | { kind: "remove"; ids: string[]; all: boolean };

/**
 * Passkeys (Supabase Auth WebAuthn): list, register a new passkey on this device, or remove one.
 */
function PasskeysRow({ security, ...props }: Expandable & { security: AccountSecurity }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: PASSKEYS_KEY, queryFn: () => security.passkeys!() });
  const passkeys = list.data ?? [];
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });

  const add = useMutation({
    mutationFn: () => security.addPasskey!(deviceLabel(os, formFactor().form, isTvDevice)),
    onSuccess: () => {
      setDone("Passkey added.");
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => security.removePasskey!(id),
    onSuccess: () => {
      setDone("Passkey removed.");
      void refresh();
    },
  });

  const addError = add.isError && (!(add.error instanceof Error) || !("code" in add.error) || add.error.code !== "cancelled");

  return (
    <ExpandRow
      setting="passkeys"
      icon={Key}
      title="Passkeys"
      caption="Sign in faster with biometrics or a security key"
      value={list.isSuccess ? (passkeys.length ? `${passkeys.length} saved` : "None") : undefined}
      {...props}
    >
      {list.isError && <p className="settings-error">{errorMessage(list.error)}</p>}
      {list.isSuccess && (
        <>
          <p className="settings-expand-text">
            {passkeys.length
              ? "You can sign in directly with any of these passkeys instead of waiting for an emailed code."
              : "Add a passkey on this device to sign in with Touch ID, Face ID, Windows Hello, or a password manager."}
          </p>
          {passkeys.length > 0 && (
            <ul className="settings-expand-text" aria-label="Passkeys">
              {passkeys.map((p) => (
                <li key={p.id}>
                  {p.name}{" "}
                  <Button variant="plain" onClick={() => (setDone(null), remove.mutate(p.id))} disabled={remove.isPending}>
                    Remove {p.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {security.passkeysSupported ? (
            <div className="settings-expand-form">
              <Button variant="primary" onClick={() => (setDone(null), add.mutate())} disabled={add.isPending}>
                {add.isPending ? "Waiting for passkey…" : "Add Passkey"}
              </Button>
            </div>
          ) : (
            <p className="settings-expand-text">This device doesn&apos;t support WebAuthn passkeys in this build.</p>
          )}
          {addError && <p className="settings-error">{errorMessage(add.error)}</p>}
          {remove.isError && <p className="settings-error">{errorMessage(remove.error)}</p>}
        </>
      )}
      {done && (
        <p className="settings-expand-text" role="status">
          {done}
        </p>
      )}
    </ExpandRow>
  );
}

/**
 * Two-step sign-in: on with an authenticator app (scan the QR code or type the key, then a code to
 * confirm), a second one as a backup, off again. Each change asks for a code first once it's on.
 */
function TwoStepRow({ security, ...props }: Expandable & { security: AccountSecurity }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: AUTHENTICATORS_KEY, queryFn: () => security.authenticators() });
  const authenticators = list.data ?? [];
  const on = authenticators.length > 0;
  const [action, setAction] = useState<TwoStepAction | null>(null);
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: AUTHENTICATORS_KEY });

  const start = useMutation({
    mutationFn: (proof?: { id: string; code: string }) => security.addAuthenticator(proof),
    onSuccess: (s) => (setSetup(s), setAction(null), setDone(null)),
  });
  const confirm = useMutation({
    mutationFn: async ({ id, code }: { id: string; code: string }) => security.confirmAuthenticator(id, code),
    onSuccess: () => {
      setSetup(null);
      setDone(on ? "Backup authenticator added." : "Two-step sign-in is on.");
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async ({ ids, proof }: { ids: string[]; proof: { id: string; code: string }; all: boolean }) => security.removeAuthenticators(ids, proof),
    onSuccess: (_v, { all }) => {
      setAction(null);
      setDone(all ? "Two-step sign-in is off." : "Authenticator removed.");
      void refresh();
    },
  });

  const cancelSetup = () => {
    if (setup) void security.cancelAuthenticator(setup.id).catch(() => {});
    setSetup(null);
    confirm.reset();
  };

  return (
    <ExpandRow
      setting="two-step"
      icon={Lock}
      title="Two-step sign-in"
      caption="A code from an authenticator app after the email code"
      value={list.isSuccess ? (on ? "On" : "Off") : undefined}
      {...props}
    >
      {list.isError && <p className="settings-error">{errorMessage(list.error)}</p>}
      {list.isSuccess && !setup && !action && (
        <>
          <p className="settings-expand-text">
            {on
              ? "Signing in with your email also asks for a code from one of these authenticator apps."
              : `Signing in with your email will also ask for a ${TWO_STEP_CODE_LENGTH}-digit code from an authenticator app on your phone.`}
          </p>
          {on && (
            <ul className="settings-expand-text" aria-label="Authenticators">
              {authenticators.map((a) => (
                <li key={a.id}>
                  {a.name}{" "}
                  <Button variant="plain" onClick={() => (setAction({ kind: "remove", ids: [a.id], all: authenticators.length === 1 }), setDone(null))}>
                    Remove {a.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="settings-expand-text">
            There are no recovery codes. If you lose the phone with your only authenticator, you can't finish signing in with your email.
            {on ? " Add a second authenticator as a backup, on another phone or in another app." : " Add a second authenticator as a backup once it's on."}
          </p>
          <div className="settings-expand-form">
            {on ? (
              <>
                <Button variant="primary" onClick={() => (setAction({ kind: "add" }), setDone(null))}>
                  Add a Backup Authenticator
                </Button>
                <Button variant="danger" onClick={() => (setAction({ kind: "remove", ids: authenticators.map((a) => a.id), all: true }), setDone(null))}>
                  Turn Off
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => start.mutate(undefined)} disabled={start.isPending}>
                {start.isPending ? "Starting…" : "Turn On"}
              </Button>
            )}
          </div>
          {start.isError && <p className="settings-error">{errorMessage(start.error)}</p>}
        </>
      )}

      {action && (
        <ProveCode
          authenticators={authenticators}
          lead={
            action.kind === "add"
              ? "First, a code from an authenticator you already have."
              : action.all
                ? "Turning two-step sign-in off: enter a code from your authenticator app."
                : "Removing an authenticator: enter a code from it or another one."
          }
          submit={action.kind === "add" ? "Continue" : action.all ? "Turn Off" : "Remove"}
          pending={start.isPending || remove.isPending}
          error={(start.isError && errorMessage(start.error)) || (remove.isError && errorMessage(remove.error)) || null}
          onProof={(proof) => (action.kind === "add" ? start.mutate(proof) : remove.mutate({ ids: action.ids, proof, all: action.all }))}
          onCancel={() => (setAction(null), start.reset(), remove.reset())}
        />
      )}

      {setup && (
        <>
          <p className="settings-expand-text">
            In your authenticator app, add an account and scan this code, or type the key below. Then enter the {TWO_STEP_CODE_LENGTH}-digit code it
            shows.
          </p>
          {setup.qr ? (
            <img className="settings-qr" src={setup.qr} alt="QR code for your authenticator app" draggable={false} />
          ) : (
            <p className="settings-expand-text">The QR code can't be shown here: type the key instead.</p>
          )}
          <p className="settings-expand-text">
            Key: <code className="settings-secret">{groupSecret(setup.secret)}</code>
          </p>
          {!on && <p className="settings-expand-text">Once it's on, your other devices may be signed out and sign in again with both codes.</p>}
          <CodeForm
            label="Code from the authenticator app"
            submit="Confirm"
            pending={confirm.isPending}
            error={confirm.isError ? errorMessage(confirm.error) : null}
            onReset={() => confirm.reset()}
            onCode={(code) => confirm.mutate({ id: setup.id, code })}
          />
          <div className="settings-expand-form">
            <Button variant="plain" onClick={cancelSetup}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {done && (
        <p className="settings-expand-text" role="status">
          {done}
        </p>
      )}
    </ExpandRow>
  );
}

/** A code from one of the account's authenticators, picked when there's more than one. */
function ProveCode({
  authenticators,
  lead,
  submit,
  pending,
  error,
  onProof,
  onCancel,
}: {
  authenticators: Authenticator[];
  lead: string;
  submit: string;
  pending: boolean;
  error: string | null;
  onProof: (proof: { id: string; code: string }) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(authenticators[0]?.id ?? "");
  return (
    <>
      <p className="settings-expand-text">{lead}</p>
      {authenticators.length > 1 && (
        <div className="settings-expand-form" role="group" aria-label="Code from">
          {authenticators.map((a) => (
            <Button key={a.id} variant={a.id === from ? "primary" : "plain"} aria-pressed={a.id === from} onClick={() => setFrom(a.id)}>
              {a.name}
            </Button>
          ))}
        </div>
      )}
      <CodeForm
        label="Code from the authenticator app"
        submit={submit}
        pending={pending}
        error={error}
        onCode={(code) => onProof({ id: from, code })}
      />
      <div className="settings-expand-form">
        <Button variant="plain" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function CodeForm({
  label,
  submit,
  pending,
  error,
  onCode,
  onReset,
}: {
  label: string;
  submit: string;
  pending: boolean;
  error: string | null;
  onCode: (code: string) => void;
  onReset?: () => void;
}) {
  const [code, setCode] = useState("");
  const [short, setShort] = useState(false);
  return (
    <FormRow
      look="expand"
      aria-label={label}
      placeholder="123456"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={TWO_STEP_CODE_LENGTH}
      value={code}
      onChange={(v) => (setCode(tidyCode(v)), setShort(false), onReset?.())}
      tidy={tidyCode}
      submit={submit}
      pending={pending}
      pendingLabel="Checking…"
      error={(short && `Enter the ${TWO_STEP_CODE_LENGTH}-digit code.`) || error}
      onSubmit={(v) => (isTwoStepCode(v) ? (onCode(v), setCode("")) : setShort(true))}
    />
  );
}
