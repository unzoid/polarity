import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import type { AccountUser, Authenticator } from "../../src/lib/account/backend";
import { accountSecurity, markSignedInByDevice, secondStepFor, tidyCode } from "../../src/lib/account/twoStep";
import { FAKE_EMAIL_CODE, FAKE_TWO_STEP_CODE, fakeAccount, resetFakeSecurity } from "../../src/lib/platform/fake/account";
import { AccountSecurityCard } from "../../src/components/settings/AccountSecurity";
import { useExpanded } from "../../src/components/settings/rows";
import { TwoStepScreen } from "../../src/screens/account/TwoStepScreen";
import { byText, click, render } from "./render";

/**
 * Settings → Account's email change and two-step sign-in, and the sign-in's second step, over the
 * fake backend (lib/platform/fake/account.ts). The account here does what AccountProvider does with
 * them: the same `accountSecurity` and `secondStepFor`, with signing in reduced to setting the user.
 */
function useFakeAccount(start: AccountUser | null): Account {
  const [user, setUser] = useState<AccountUser | null>(start);
  const [twoStep, setTwoStep] = useState<Authenticator[] | null>(null);
  const security = useMemo(() => accountSecurity(fakeAccount, (u) => setUser(u)), []);
  return {
    enabled: true,
    status: user ? "ready" : "signed-out",
    user,
    profiles: [],
    profile: null,
    twoStep,
    security,
    async verifyCode(email: string, code: string) {
      const u = await fakeAccount.auth.verifyCode(email, code);
      const second = await secondStepFor(fakeAccount, u);
      if (second) setTwoStep(second);
      else setUser(u);
    },
    async verifyTwoStep(id: string, code: string) {
      const u = await fakeAccount.twoStep.verify(id, tidyCode(code));
      setTwoStep(null);
      setUser(u);
    },
    async cancelTwoStep() {
      setTwoStep(null);
      await fakeAccount.auth.signOut();
    },
  } as unknown as Account;
}

let account: Account;
function App({ start }: { start: AccountUser | null }) {
  account = useFakeAccount(start);
  const expand = useExpanded();
  return (
    <AccountContext.Provider value={account}>
      {account.twoStep ? <TwoStepScreen /> : account.user ? <AccountSecurityCard expand={expand} /> : <p>Signed out</p>}
      {account.user && <p data-testid="who">Signed in as {account.user.email}</p>}
    </AccountContext.Provider>
  );
}

const mount = async (start: AccountUser | null) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App start={start} />
    </QueryClientProvider>,
  );

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const field = (label: string) => {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`no field "${label}"`);
  return el;
};

/** Fills a FormRow and sends it with its button. */
async function submit(label: string, value: string, button: string) {
  const input = field(label);
  await type(input, value);
  await click(byText(input.closest("form")!, "button", button));
  await settle();
}

const text = () => document.body.textContent ?? "";
const row = (title: string) => [...document.querySelectorAll<HTMLElement>(".settings-row-button")].find((b) => b.textContent?.includes(title))!;
const alerts = () => [...document.querySelectorAll(".settings-error, [role=alert]")].map((e) => e.textContent).join(" ");

const signedIn = () => fakeAccount.auth.current() as Promise<AccountUser>;

beforeEach(() => resetFakeSecurity());
afterEach(() => resetFakeSecurity());

async function turnOn() {
  await click(row("Two-step sign-in"));
  await settle();
  expect(row("Two-step sign-in").textContent).toContain("Off");
  expect(text()).toContain("There are no recovery codes.");
  await click(byText(document.body, "button", "Turn On"));
  await settle();
}

test("Turning two-step sign-in on: the QR code and the key, a wrong code refused, the right one turns it on", async () => {
  const { unmount } = await mount({ ...(await signedIn()) });
  await turnOn();
  const qr = document.querySelector<HTMLImageElement>("img.settings-qr")!;
  expect(qr.getAttribute("src")!.startsWith("data:image/svg+xml")).toBe(true);
  expect(qr.getAttribute("alt")).toBe("QR code for your authenticator app");
  expect(text()).toContain("FAKE SECR ETXX XXXX");

  await submit("Code from the authenticator app", "000000", "Confirm");
  expect(alerts()).toContain("That code is wrong");
  expect(await fakeAccount.twoStep.list()).toEqual([]);

  await submit("Code from the authenticator app", FAKE_TWO_STEP_CODE, "Confirm");
  expect(text()).toContain("Two-step sign-in is on.");
  expect(row("Two-step sign-in").textContent).toContain("On");
  expect((await fakeAccount.twoStep.list()).length).toBe(1);
  await unmount();
});

test("A backup authenticator asks for a code from the first one before its QR code", async () => {
  const { unmount } = await mount({ ...(await signedIn()) });
  await turnOn();
  await submit("Code from the authenticator app", FAKE_TWO_STEP_CODE, "Confirm");
  await click(byText(document.body, "button", "Add a Backup Authenticator"));
  await settle();
  expect(document.querySelector("img.settings-qr")).toBeNull();
  await submit("Code from the authenticator app", "111111", "Continue");
  expect(alerts()).toContain("That code is wrong");
  await submit("Code from the authenticator app", FAKE_TWO_STEP_CODE, "Continue");
  expect(document.querySelector("img.settings-qr")).not.toBeNull();
  await submit("Code from the authenticator app", FAKE_TWO_STEP_CODE, "Confirm");
  expect(text()).toContain("Backup authenticator added.");
  expect((await fakeAccount.twoStep.list()).map((a) => a.name)).toEqual(["Authenticator 1", "Authenticator 2"]);
  await unmount();
});

test("Turning it off asks for a code first; a wrong one leaves it on", async () => {
  const setup = await fakeAccount.twoStep.add();
  await fakeAccount.twoStep.confirmAdd(setup.id, FAKE_TWO_STEP_CODE);
  const { unmount } = await mount({ ...(await signedIn()) });
  await click(row("Two-step sign-in"));
  await settle();
  await click(byText(document.body, ".settings-expand-form button", "Turn Off"));
  await settle();
  await submit("Code from the authenticator app", "999999", "Turn Off");
  expect(alerts()).toContain("That code is wrong");
  expect((await fakeAccount.twoStep.list()).length).toBe(1);
  await submit("Code from the authenticator app", FAKE_TWO_STEP_CODE, "Turn Off");
  expect(text()).toContain("Two-step sign-in is off.");
  expect(row("Two-step sign-in").textContent).toContain("Off");
  expect(await fakeAccount.twoStep.list()).toEqual([]);
  await unmount();
});

test("Signing in with two-step on: no user until the authenticator code; a wrong code, then another authenticator", async () => {
  for (let i = 0; i < 2; i++) {
    const s = await fakeAccount.twoStep.add();
    await fakeAccount.twoStep.confirmAdd(s.id, FAKE_TWO_STEP_CODE);
  }
  await fakeAccount.auth.signOut();
  const { unmount } = await mount(null);
  await act(() => account.verifyCode("robin@example.com", "000000"));
  await settle();
  expect(byText(document.body, "h1", "Two-step sign-in")).toBeTruthy();
  expect(account.user).toBeNull();
  expect(document.querySelector("[data-testid=who]")).toBeNull();
  expect(text()).toContain("Authenticator 1");

  await type(field("Authenticator code"), "000000");
  await settle();
  expect(alerts()).toContain("That code is wrong");
  expect(account.user).toBeNull();

  await click(byText(document.body, "button", "Use another authenticator"));
  await click(byText(document.body, "button", "Authenticator 2"));
  expect(text()).toContain("Authenticator 2");
  await type(field("Authenticator code"), FAKE_TWO_STEP_CODE);
  await settle();
  expect(document.querySelector("[data-testid=who]")!.textContent).toBe("Signed in as robin@example.com");
  await unmount();
});

test("Back to sign in from the second step drops the half-done session", async () => {
  const s = await fakeAccount.twoStep.add();
  await fakeAccount.twoStep.confirmAdd(s.id, FAKE_TWO_STEP_CODE);
  const { unmount } = await mount(null);
  await act(() => account.verifyCode("robin@example.com", "000000"));
  await settle();
  await click(byText(document.body, "button", "Back to sign in"));
  await settle();
  expect(text()).toContain("Signed out");
  expect(await fakeAccount.auth.current()).toBeNull();
  await unmount();
});

test("A device signed in by another device's approval asks for no authenticator code", async () => {
  const s = await fakeAccount.twoStep.add();
  await fakeAccount.twoStep.confirmAdd(s.id, FAKE_TWO_STEP_CODE);
  const u = await fakeAccount.tvSignIn.finish("TOKEN");
  // The server would still ask this session (an email sign-in's would be asked): the app doesn't.
  expect((await fakeAccount.twoStep.pending()).length).toBe(1);
  expect(await secondStepFor(fakeAccount, u)).not.toBeNull();
  markSignedInByDevice(u.id);
  expect(await secondStepFor(fakeAccount, u)).toBeNull();
});

test("Changing the email: taken address, then a new one waiting for both codes; the address shown changes only at the end", async () => {
  const { unmount } = await mount({ ...(await signedIn()) });
  await click(row("Email address"));
  await settle();
  expect(row("Email address").textContent).toContain("robin@example.com");

  await submit("New email address", "robin@example.com", "Change");
  expect(alerts()).toContain("That's already your email address.");
  await submit("New email address", "not an address", "Change");
  expect(alerts()).toContain("Enter a valid email address.");
  await submit("New email address", "taken@example.com", "Change");
  expect(alerts()).toContain("already used by another account");

  await submit("New email address", "New@Example.com", "Change");
  expect(text()).toContain("Check new@example.com to confirm");
  expect(row("Email address").textContent).toContain("Waiting for confirmation of new@example.com");
  expect(account.user!.email).toBe("robin@example.com");

  await submit("Code sent to new@example.com", "111111", "Confirm");
  expect(alerts()).toContain("That code is wrong or has expired.");
  await submit("Code sent to new@example.com", FAKE_EMAIL_CODE, "Confirm");
  expect(text()).toContain("Now enter the code sent to robin@example.com");
  expect(account.user!.email).toBe("robin@example.com");

  await submit("Code sent to robin@example.com", FAKE_EMAIL_CODE, "Confirm");
  expect(text()).toContain("Your email address is now new@example.com.");
  expect(account.user!.email).toBe("new@example.com");
  expect(row("Email address").textContent).toContain("new@example.com");
  expect(document.querySelector("[data-testid=who]")!.textContent).toBe("Signed in as new@example.com");
  await unmount();
});

test("An email change asked for earlier still waits for its code when Settings opens again", async () => {
  await fakeAccount.auth.changeEmail("later@example.com");
  const { unmount } = await mount({ ...(await signedIn()) });
  expect(row("Email address").textContent).toContain("Waiting for confirmation of later@example.com");
  await click(row("Email address"));
  await settle();
  expect(field("Code sent to later@example.com")).toBeTruthy();
  await click(byText(document.body, "button", "Use Another Address"));
  expect(field("New email address")).toBeTruthy();
  await unmount();
});
