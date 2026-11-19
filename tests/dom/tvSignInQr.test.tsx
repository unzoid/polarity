// Signing in a TV by its QR code (#133): the code screen draws the code it shows as a QR code, and
// on the other device the link's code lands on "Sign in on <device>?" without answering it.
import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthScreen } from "../../src/screens/account/AuthScreen";
import { QR_QUIET, qrModules } from "../../src/screens/account/TvSignInQr";
import { SettingsOverlay } from "../../src/components/SettingsOverlay";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import type { TvSignInRequest, TvWaitResult } from "../../src/lib/account";
import { offerTvCode, takeTvCode } from "../../src/lib/account/tvSignInLink";
import { tvSignInLink } from "../../src/lib/deepLink/deepLink";
import { closeSettings, openSettings } from "../../src/lib/settings/overlay";
import { byText, click, render } from "./render";

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`never: ${what}`);
}

test("the code screen shows a QR code for the code it shows, and a new code redraws it", async () => {
  const codes = ["HJKMNPQR", "23456789"];
  const ends: ((end: TvWaitResult) => void)[] = [];
  const account = {
    enabled: true,
    status: "signed-out",
    canCancelSignIn: true,
    cancelSignIn: () => {},
    continueAsGuest: () => {},
    tvSignIn: {
      start: async (): Promise<TvSignInRequest> => ({ code: codes.shift()!, poll: "xxx", expiresAt: Date.now() + 600_000 }),
      wait: () => new Promise<TvWaitResult>((r) => ends.push(r)),
    },
  } as unknown as Account;
  const { container, unmount } = await render(
    <AccountContext.Provider value={account}>
      <AuthScreen />
    </AccountContext.Provider>,
  );
  await click(byText(container, "button", "Sign in with another device"));
  const shown = () => container.querySelector(".auth-device-code")?.textContent ?? "";
  const qr = () => container.querySelector<SVGElement>(".auth-device-qr svg");
  await until(() => shown() === "HJKM-NPQR" && !!qr(), "the first code");

  const check = (code: string, as: string) => {
    const svg = qr()!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toContain(as);
    expect(svg.dataset.link).toBe(tvSignInLink(code));
    // What's drawn is that link's modules: as many dark squares, on a white square with its quiet zone.
    const modules = qrModules(tvSignInLink(code));
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${modules.length} ${modules.length}`);
    expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#fff");
    const squares = svg.querySelector("path")!.getAttribute("d")!.match(/M/g)!.length;
    expect(squares).toBe(modules.flat().filter(Boolean).length);
  };
  check("HJKMNPQR", "HJKM-NPQR");
  // The words stay for people without a camera.
  expect(container.textContent).toContain("Settings → Account → Sign in a TV");

  await act(async () => ends[0]("expired"));
  await until(() => !qr(), "the expired code's QR going away");
  await click(byText(container, "button", "Get a new code"));
  await until(() => shown() === "2345-6789" && !!qr(), "the new code");
  check("23456789", "2345-6789");
  await unmount();
});

test("a QR code's modules: a quiet zone all round and the three finder patterns inside it", () => {
  const modules = qrModules(tvSignInLink("HJKMNPQR"));
  const n = modules.length;
  const inner = n - QR_QUIET * 2;
  // A version 1–40 symbol is 17 + 4v modules a side.
  expect((inner - 17) % 4).toBe(0);
  expect(modules.every((row) => row.length === n)).toBe(true);
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < QR_QUIET; q++) {
      expect(modules[q][i] || modules[n - 1 - q][i] || modules[i][q] || modules[i][n - 1 - q]).toBe(false);
    }
  }
  const finder = (top: number, left: number) => {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ring = y === 0 || y === 6 || x === 0 || x === 6;
        const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        expect(modules[top + y][left + x]).toBe(ring || core);
      }
  };
  finder(QR_QUIET, QR_QUIET);
  finder(QR_QUIET, n - QR_QUIET - 7);
  finder(n - QR_QUIET - 7, QR_QUIET);
  // A different code is a different picture.
  expect(qrModules(tvSignInLink("23456789"))).not.toEqual(modules);
});

test("a code from a link opens on the question; nothing is answered until the person does", async () => {
  takeTvCode();
  const answered: unknown[] = [];
  const looked: string[] = [];
  const account = {
    enabled: true,
    status: "ready",
    user: { id: "u1", email: "ada@example.com" },
    profile: { id: "p1", name: "Wizard", avatar: "fox" },
    profiles: [{ id: "p1", name: "Wizard", avatar: "fox" }],
    showSignIn: () => {},
    signOut: async () => {},
    tvSignIn: {
      look: async (code: string) => (looked.push(code), "Android TV"),
      answer: async (code: string, approve: boolean) => void answered.push([code, approve]),
    },
  } as unknown as Account;
  const { unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountContext.Provider value={account}>
        <SettingsOverlay />
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  offerTvCode("HJKMNPQR");
  await act(async () => openSettings("account"));
  await until(() => !!document.body.textContent?.includes("Sign in on Android TV?"), "the question");
  expect(looked).toEqual(["HJKMNPQR"]);
  expect(answered).toEqual([]);
  await click(byText(document.body, "button", "Approve"));
  await settle();
  expect(answered).toEqual([["HJKMNPQR", true]]);
  await unmount();
  closeSettings();
});
