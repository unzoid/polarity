import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import type { AccountUser } from "../../src/lib/account/backend";
import { accountSecurity } from "../../src/lib/account/twoStep";
import { fakeAccount, resetFakeSecurity, setFakePasskeysSupported } from "../../src/lib/platform/fake/account";
import { AccountSecurityCard } from "../../src/components/settings/AccountSecurity";
import { useExpanded } from "../../src/components/settings/rows";
import { AuthScreen } from "../../src/screens/account/AuthScreen";
import { byText, click, render } from "./render";

function useFakePasskeyAccount(): Account {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [passkeyPromptUser, setPasskeyPromptUser] = useState<AccountUser | null>(null);
  const security = useMemo(() => accountSecurity(fakeAccount, (u) => setUser(u)), []);

  return {
    enabled: true,
    status: user ? "ready" : "signed-out",
    user,
    profiles: [],
    profile: null,
    canCancelSignIn: false,
    twoStep: null,
    passkeysSupported: fakeAccount.passkeys.supported(),
    passkeyPrompt: !!passkeyPromptUser,
    security,
    async sendCode(email: string) {
      await fakeAccount.auth.sendCode(email);
    },
    async verifyCode(email: string, code: string) {
      const u = await fakeAccount.auth.verifyCode(email, code);
      if (fakeAccount.passkeys.supported()) {
        const list = await fakeAccount.passkeys.list();
        if (list.length === 0) {
          setPasskeyPromptUser(u);
          return;
        }
      }
      setUser(u);
    },
    async signInWithPasskey() {
      const u = await fakeAccount.passkeys.signIn();
      setUser(u);
    },
    async addPasskey() {
      const u = passkeyPromptUser!;
      await fakeAccount.passkeys.register("Mac");
      setPasskeyPromptUser(null);
      setUser(u);
    },
    async skipPasskeySetup() {
      const u = passkeyPromptUser!;
      setPasskeyPromptUser(null);
      setUser(u);
    },
    continueAsGuest() {},
    cancelSignIn() {},
    async resume() {},
    async signOut() {
      await fakeAccount.auth.signOut();
      setUser(null);
    },
  } as unknown as Account;
}

let account: Account;
function App() {
  account = useFakePasskeyAccount();
  const expand = useExpanded();
  return (
    <AccountContext.Provider value={account}>
      {account.user ? (
        <>
          <p data-testid="who">Signed in as {account.user.email}</p>
          <AccountSecurityCard expand={expand} />
        </>
      ) : (
        <AuthScreen />
      )}
    </AccountContext.Provider>
  );
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const v = check();
    if (v) return v;
    await settle();
  }
  throw new Error(`never: ${what}`);
}

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const text = () => document.body.textContent ?? "";

beforeEach(() => resetFakeSecurity());
afterEach(() => resetFakeSecurity());

test("signing in to an account without a passkey prompts Setup Passkey; adding one registers it and skips the prompt next time", async () => {
  const { unmount } = await mount();
  const email = document.querySelector<HTMLInputElement>('input[aria-label="Email address"]')!;
  await type(email, "robin@example.com");
  const cont = await until(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Continue"), "Continue button");
  await click(cont);

  const code = await until(() => document.querySelector<HTMLInputElement>('input[aria-label="Verification code"]'), "Verification code field");
  await type(code, "123456");

  await until(() => [...document.querySelectorAll("h1")].find((h) => h.textContent?.trim() === "Setup Passkey"), "Setup Passkey heading");
  expect(text()).toContain("Login Faster");
  expect(text()).toContain("Enhanced Security");
  expect(text()).toContain("Multi-Device Support");
  expect(account.user).toBeNull();

  await click(byText(document.body, "button", "Add Passkey"));
  await until(() => document.querySelector("[data-testid=who]")?.textContent === "Signed in as robin@example.com", "signed in");
  expect((await fakeAccount.passkeys.list()).length).toBe(1);

  // Settings → Account shows the saved passkey and allows removing it.
  const passkeysRow = await until(
    () => [...document.querySelectorAll<HTMLElement>(".settings-row-button")].find((b) => b.textContent?.includes("1 saved")),
    "Passkeys row showing 1 saved",
  );
  await click(passkeysRow);
  await settle();
  expect(text()).toContain("Mac");

  // Sign out and sign back in with the registered passkey directly.
  await act(() => account.signOut());
  const passkeyBtn = await until(
    () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Sign In with Passkey")),
    "Sign In with Passkey button",
  );
  await click(passkeyBtn);
  await until(() => document.querySelector("[data-testid=who]")?.textContent === "Signed in as robin@example.com", "signed in via passkey");

  await unmount();
});

test("Skip for now dismisses Setup Passkey and completes sign-in", async () => {
  const { unmount } = await mount();
  await act(() => account.verifyCode("robin@example.com", "123456"));
  await until(() => [...document.querySelectorAll("h1")].find((h) => h.textContent?.trim() === "Setup Passkey"), "Setup Passkey heading");

  await click(byText(document.body, "button", "Skip for now"));
  await until(() => document.querySelector("[data-testid=who]")?.textContent === "Signed in as robin@example.com", "signed in after skip");
  expect((await fakeAccount.passkeys.list()).length).toBe(0);
  await unmount();
});

test("when passkeys aren't supported on the device, sign-in skips Setup Passkey", async () => {
  setFakePasskeysSupported(false);
  const { unmount } = await mount();
  expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Sign In with Passkey"))).toBe(false);
  await act(() => account.verifyCode("robin@example.com", "123456"));
  await settle();
  expect(document.querySelector("[data-testid=who]")?.textContent).toBe("Signed in as robin@example.com");
  await unmount();
});
