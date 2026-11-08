import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsOverlay } from "../../src/components/SettingsOverlay";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import { closeSettings, openSettings } from "../../src/lib/settings/overlay";
import { byText, click, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const account = {
  enabled: true,
  status: "ready",
  user: { id: "u1", email: "ada@example.com" },
  profile: { id: "p1", name: "Wizard", avatar: "fox" },
  profiles: [{ id: "p1", name: "Wizard", avatar: "fox" }],
  showSignIn: () => {},
  signOut: async () => {},
} as unknown as Account;

/** The overlay for one test (the page is emptied after each); `done` takes it away and leaves Settings closed. */
async function mount() {
  const { unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountContext.Provider value={account}>
        <SettingsOverlay />
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  return async () => {
    await unmount();
    closeSettings();
  };
}

const dialog = () => document.querySelector<HTMLElement>(".t3s")!;
const pageName = () => dialog().querySelector(".t3s-crumb-page")!.textContent;
const profileButton = () => byText(dialog().querySelector(".t3s-sidebar-foot")!, "button", "Wizard");
const reopen = async (page?: string) => {
  await act(async () => closeSettings());
  await settle();
  await act(async () => openSettings(page));
  await settle();
};

test("Settings sidebar lists no Account section; the profile button opens Account and shows it as current (#340)", async () => {
  const done = await mount();
  await reopen();
  const sections = [...dialog().querySelectorAll(".t3s-groups .t3s-nav-item")].map((b) => b.textContent?.trim());
  expect(sections).toContain("Playback");
  expect(sections).not.toContain("Account");
  expect(profileButton().getAttribute("aria-current")).toBeNull();
  await click(profileButton());
  expect(pageName()).toBe("Account");
  expect(profileButton().getAttribute("aria-current")).toBe("page");
  expect(profileButton().dataset.active).toBe("true");
  await click(byText(dialog(), ".t3s-groups .t3s-nav-item", "Appearance"));
  expect(profileButton().getAttribute("aria-current")).toBeNull();
  await done();
});

test("Profile menu's Account opens Account; its Settings after Account opens Playback, else where it was left (#340)", async () => {
  const done = await mount();
  await reopen("account");
  expect(pageName()).toBe("Account");
  await reopen();
  expect(pageName()).toBe("Playback");
  await click(byText(dialog(), ".t3s-groups .t3s-nav-item", "Appearance"));
  await reopen();
  expect(pageName()).toBe("Appearance");
  await click(profileButton());
  await reopen();
  expect(pageName()).toBe("Playback");
  await done();
});

test("Searching Settings still finds an Account row and opens the Account page (#340)", async () => {
  const done = await mount();
  await reopen();
  const field = dialog().querySelector<HTMLInputElement>(".t3s-search input")!;
  const results = () => [...dialog().querySelectorAll<HTMLElement>(".t3s-result")];
  for (const q of ["profile", "passphrase", "sign out", "account"]) {
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(field, q);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const hit = results().find((r) => r.querySelector(".t3s-result-page")?.textContent === "Account");
    if (!hit) continue;
    await click(hit);
    expect(pageName()).toBe("Account");
    return done();
  }
  await done();
  throw new Error("no search reached an Account row");
});
