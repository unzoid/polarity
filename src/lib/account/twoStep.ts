/**
 * Two-step sign-in (a code from an authenticator app after the email code) and changing the
 * account's email: the parts the provider, the screens and the tests share. The server's side is
 * `AccountBackend.twoStep` and `auth.changeEmail` (supabase.ts, fake/account.ts).
 */
import type { AccountBackend, AccountUser, Authenticator, AuthenticatorSetup, Passkey } from "./backend";

/** Authenticator codes are six digits. */
export const TWO_STEP_CODE_LENGTH = 6;

/** What was typed or pasted, as a code: digits only. */
export const tidyCode = (v: string) => v.replace(/\D/g, "").slice(0, TWO_STEP_CODE_LENGTH);

export const isTwoStepCode = (v: string) => new RegExp(`^\\d{${TWO_STEP_CODE_LENGTH}}$`).test(v);

const SVG_PREFIX = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),/i;

/**
 * The QR code the server returns, as an image address the web view can show: an SVG data URI,
 * with the SVG escaped (supabase-js prefixes the raw SVG, where a `#` would end the address).
 * Anything but an image's data is refused (`""`): no address that loads from elsewhere.
 */
export function qrImage(qr: string): string {
  const raw = qr.trim();
  const svg = raw.startsWith("<") ? raw : SVG_PREFIX.test(raw) ? raw.replace(SVG_PREFIX, "") : null;
  if (svg !== null) {
    let text = svg;
    try {
      // Already escaped (`%3Csvg…`): taken back to the SVG first, so it isn't escaped twice.
      if (!text.startsWith("<")) text = decodeURIComponent(text);
    } catch {
      return "";
    }
    return text.startsWith("<") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}` : "";
  }
  return /^data:image\/(png|svg\+xml)[;,]/i.test(raw) ? raw : "";
}

/** The secret in groups of four, easier to type into an authenticator app. */
export const groupSecret = (secret: string) => secret.replace(/\s/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/** A trimmed, lower-cased address; `null` when it doesn't look like one. */
export function tidyEmail(v: string): string | null {
  const email = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Where an email change stands for `user`, who asked for `to`: confirmed (the account's address is
 * `to`), or still waiting for a code.
 */
export const emailChanged = (user: AccountUser, to: string) => user.email.toLowerCase() === to.toLowerCase();

/**
 * Sessions that came from "Sign in with another device" (#133): the approving device was signed in
 * in full, so the TV asks for no authenticator code. Remembered for the user it was, on this device.
 */
const BY_DEVICE_KEY = "polar.signedInByDevice";

export const markSignedInByDevice = (userId: string) => localStorage.setItem(BY_DEVICE_KEY, userId);
export const forgetSignedInByDevice = () => localStorage.removeItem(BY_DEVICE_KEY);
const signedInByDevice = (userId: string) => localStorage.getItem(BY_DEVICE_KEY) === userId;

/**
 * Whether the user's session still has to give an authenticator code before the app treats them as
 * signed in: the authenticators to ask, or `null`. A session from another device's approval never asks.
 */
export async function secondStepFor(b: Pick<AccountBackend, "twoStep">, user: AccountUser): Promise<Authenticator[] | null> {
  if (signedInByDevice(user.id)) return null;
  const pending = await b.twoStep.pending();
  return pending.length ? pending : null;
}

/** Settings → Account: the email address and two-step sign-in, as the screens use them. */
export interface AccountSecurity {
  /** Sends the confirmation codes; the address shown stays the same until they're in. */
  changeEmail(email: string): Promise<void>;
  /** One code from the change, sent to `address`; true once the address has changed. */
  confirmEmailChange(address: string, to: string, code: string): Promise<boolean>;
  /** Reads the user again (an email change confirmed elsewhere). */
  refreshUser(): Promise<void>;
  authenticators(): Promise<Authenticator[]>;
  /** A new authenticator; with authenticators already on, a code from one of them first. */
  addAuthenticator(proof?: { id: string; code: string }): Promise<AuthenticatorSetup>;
  confirmAuthenticator(id: string, code: string): Promise<void>;
  cancelAuthenticator(id: string): Promise<void>;
  removeAuthenticators(ids: string[], proof: { id: string; code: string }): Promise<void>;
  /** Whether this runtime supports WebAuthn passkeys. */
  passkeysSupported?: boolean;
  /** Registered passkeys on this account (optional when constructed in older test stubs). */
  passkeys?(): Promise<Passkey[]>;
  addPasskey?(friendlyName?: string): Promise<Passkey>;
  removePasskey?(id: string): Promise<void>;
}

/** The account's `security`, over a backend; `onUser` gets the user whenever it's read again. */
export function accountSecurity(
  b: Pick<AccountBackend, "auth" | "twoStep"> & Partial<Pick<AccountBackend, "passkeys">>,
  onUser: (user: AccountUser) => void,
): AccountSecurity {
  return {
    async changeEmail(email) {
      await b.auth.changeEmail(email.trim().toLowerCase());
      const u = await b.auth.refreshUser().catch(() => null);
      if (u) onUser(u);
    },
    async confirmEmailChange(address, to, code) {
      const u = await b.auth.confirmEmailChange(address.trim().toLowerCase(), tidyCode(code));
      onUser(u);
      return emailChanged(u, to);
    },
    async refreshUser() {
      const u = await b.auth.refreshUser();
      if (u) onUser(u);
    },
    authenticators: () => b.twoStep.list(),
    async addAuthenticator(proof) {
      if (proof) await b.twoStep.verify(proof.id, tidyCode(proof.code));
      return b.twoStep.add();
    },
    confirmAuthenticator: (id, code) => b.twoStep.confirmAdd(id, tidyCode(code)),
    cancelAuthenticator: (id) => b.twoStep.cancelAdd(id),
    removeAuthenticators: (ids, proof) => b.twoStep.remove(ids, { id: proof.id, code: tidyCode(proof.code) }),
    ...(b.passkeys
      ? {
          passkeysSupported: b.passkeys.supported(),
          passkeys: () => b.passkeys!.list(),
          addPasskey: (name?: string) => b.passkeys!.register(name),
          removePasskey: (id: string) => b.passkeys!.remove(id),
        }
      : {}),
  };
}
