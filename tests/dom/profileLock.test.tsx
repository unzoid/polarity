import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import type { Profile, ProfileLock } from "../../src/lib/account/backend";
import { hashPin } from "../../src/lib/account/pin";
import type { GuardContext } from "../../src/lib/account/profileGuard";
import { endUnlocks, setActiveLock, setPinAsker, type PinAnswer, type PinRequest } from "../../src/lib/account/unlock";
import { useViewingLimit } from "../../src/lib/catalog/viewingLimit";
import { setPrefs } from "../../src/lib/settings/prefs";
import { PinFlow } from "../../src/components/profileLock/PinFlow";
import { ProfileLockRows } from "../../src/components/profileLock/ProfileLockRows";
import { ManageGate } from "../../src/components/profileLock/ManageGate";
import { LimitFromProfile } from "../../src/components/profileLock/LimitFromProfile";
import { ProfilesScreen } from "../../src/screens/account/ProfilesScreen";
import { byText, click, press, render } from "./render";

const HASH = await hashPin("2468", { iterations: 1000 });
const p = (id: string, name: string, lock: Partial<ProfileLock> | null = {}): Profile =>
  ({ id, name, avatar: "fox", position: 0, ...(lock && { lock: { pin: null, viewingLimit: null, hideUnrated: false, ...lock } }) }) as Profile;

const parent = p("parent", "Dana", { pin: HASH });
const kid = p("kid", "Milo", { viewingLimit: 9 });

afterEach(() => {
  localStorage.removeItem("polar.pinTries");
  endUnlocks();
  setActiveLock(null);
  setPrefs({ viewingLimit: 0, viewingHideUnrated: false }, { quiet: true });
});

/** An account with these profiles, `actor` in use; every ask goes to `answer`. */
function accountWith(actor: Profile | null, profiles: Profile[], calls: string[] = []): Account {
  const setLock = async (id: string, patch: Partial<ProfileLock>) => void calls.push(`lock ${id} ${JSON.stringify(patch)}`);
  const ctx: GuardContext = { actor, profiles, reauth: null, setLock };
  return {
    profile: actor,
    profiles,
    lastProfileId: actor?.id ?? null,
    signOut: async () => {},
    chooseProfile: async (x: Profile) => void calls.push(`enter ${x.id}`),
    guardContext: () => ctx,
    setProfileLock: setLock,
  } as unknown as Account;
}

const digits = async (root: ParentNode, pin: string) => {
  for (const d of pin) await click(byText(root, "button", d));
};
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

test("PIN prompt: a wrong PIN says so and empties; the right one answers with the profile", async () => {
  const answers: PinAnswer[] = [];
  const view = await render(<PinFlow request={{ kind: "check", title: "Enter Dana's PIN", profiles: [parent] }} onDone={(a) => answers.push(a)} />);
  await digits(view.container, "1111");
  await settle();
  expect(view.container.querySelector("[role=alert]")!.textContent).toBe("That PIN isn't right.");
  expect(view.container.querySelectorAll(".pin-dot[data-filled]")).toHaveLength(0);
  // A real keyboard (or a remote's number keys) types too.
  for (const d of "2468") await press(d, window);
  await settle();
  expect(answers).toEqual([{ profile: "parent", pin: "2468" }]);
  await view.unmount();
});

test("PIN prompt: after a few wrong PINs it makes you wait, and the keys stop", async () => {
  const view = await render(<PinFlow request={{ kind: "check", title: "PIN", profiles: [parent] }} onDone={() => {}} />);
  for (let i = 0; i < 3; i++) {
    await digits(view.container, "0000");
    await settle();
  }
  expect(view.container.querySelector("[role=alert]")!.textContent).toMatch(/^Too many wrong PINs\. Try again in 30 seconds\.$/);
  expect(byText(view.container, "button", "5").hasAttribute("disabled")).toBe(true);
  await view.unmount();
});

test("PIN prompt: with several parents, it asks whose PIN first", async () => {
  const other = p("other", "Sam", { pin: HASH });
  const answers: PinAnswer[] = [];
  const view = await render(<PinFlow request={{ kind: "check", title: "Enter a parent's PIN", profiles: [parent, other] }} onDone={(a) => answers.push(a)} />);
  expect(view.container.textContent).toContain("Whose PIN?");
  await click(byText(view.container, "button", "Sam"));
  await digits(view.container, "2468");
  await settle();
  expect(answers).toEqual([{ profile: "other", pin: "2468" }]);
  await view.unmount();
});

test("new PIN: typed twice; a mismatch starts again", async () => {
  const answers: PinAnswer[] = [];
  const view = await render(<PinFlow request={{ kind: "new", title: "A PIN for Dana" }} onDone={(a) => answers.push(a)} />);
  await digits(view.container, "1357");
  expect(view.container.textContent).toContain("Enter it again.");
  await digits(view.container, "1358");
  expect(view.container.textContent).toContain("Those didn't match. Start again.");
  await digits(view.container, "1357");
  await digits(view.container, "1357");
  expect(answers).toEqual([{ pin: "1357" }]);
  await view.unmount();
});

test("edit sheet: a profile without a PIN offers one, a limit says who can change it, and warns without a parent's PIN", async () => {
  const other = p("other", "Sam");
  const view = await render(
    <AccountContext.Provider value={accountWith(other, [other, kid])}>
      <ProfileLockRows profile={kid} />
    </AccountContext.Provider>,
  );
  const text = view.container.textContent!;
  expect(byText(view.container, "button", "Set PIN")).toBeTruthy();
  expect(text).toContain("Viewing limit");
  expect(text).toContain("Hide titles rated above");
  expect(text).toContain("Also hide titles without a rating");
  expect(text).toContain("Without a PIN on your own profile, anyone can switch away from this profile and change its limit.");
  expect(byText(view.container, "button", "Set a PIN for Sam")).toBeTruthy();
  await view.unmount();
});

test("edit sheet: setting a PIN asks for it twice and stores only its hash", async () => {
  const calls: string[] = [];
  const asked: PinRequest[] = [];
  const undo = setPinAsker(async (r) => (asked.push(r), { pin: "9753" }));
  const view = await render(
    <AccountContext.Provider value={accountWith(parent, [parent, kid], calls)}>
      <ProfileLockRows profile={kid} />
    </AccountContext.Provider>,
  );
  await click(byText(view.container, "button", "Set PIN"));
  for (let i = 0; i < 100 && !calls.length; i++) await settle();
  expect(asked.map((r) => r.kind)).toEqual(["new"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith("lock kid ");
  expect(calls[0]).toContain("pbkdf2-sha256$600000$");
  expect(calls[0]).not.toContain("9753");
  undo();
  await view.unmount();
});

test("edit sheet: on a server without PINs, it says they aren't available", async () => {
  const old = p("old", "Old", null);
  const view = await render(
    <AccountContext.Provider value={accountWith(old, [old])}>
      <ProfileLockRows profile={old} />
    </AccountContext.Provider>,
  );
  expect(view.container.textContent).toBe("A PIN and a viewing limit aren't available on this account server yet.");
  await view.unmount();
});

test("a restricted profile is refused Manage Profiles without a parent's PIN", async () => {
  const asked: PinRequest[] = [];
  const undo = setPinAsker(async (r) => (asked.push(r), null));
  const view = await render(
    <AccountContext.Provider value={accountWith(kid, [parent, kid])}>
      <ProfilesScreen />
    </AccountContext.Provider>,
  );
  await click(byText(view.container, "button", "Manage Profiles"));
  await settle();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ kind: "check", title: "Enter Dana's PIN", profiles: [parent] });
  expect(view.container.querySelector("h1")!.textContent).toBe("Who's watching?");
  undo();
  await view.unmount();
});

test("a profile with a PIN isn't entered from the picker until it's typed", async () => {
  const calls: string[] = [];
  let answer: PinAnswer = null;
  const undo = setPinAsker(async () => answer);
  const view = await render(
    <AccountContext.Provider value={accountWith(kid, [parent, kid], calls)}>
      <ProfilesScreen />
    </AccountContext.Provider>,
  );
  await click(view.container.querySelector('[aria-label="Dana"]'));
  await settle();
  expect(calls).toEqual([]);
  answer = { profile: "parent", pin: "2468" };
  await click(view.container.querySelector('[aria-label="Dana"]'));
  await settle();
  expect(calls).toEqual(["enter parent"]);
  undo();
  await view.unmount();
});

test("Settings → Account is locked on a restricted profile until unlocked", async () => {
  const undo = setPinAsker(async () => ({ profile: "parent", pin: "2468" }));
  const view = await render(
    <AccountContext.Provider value={accountWith(kid, [parent, kid])}>
      <ManageGate>
        <p>Account rows</p>
      </ManageGate>
    </AccountContext.Provider>,
  );
  expect(view.container.textContent).not.toContain("Account rows");
  expect(view.container.textContent).toContain("This profile has a viewing limit");
  await click(byText(view.container, "button", "Unlock"));
  await settle();
  expect(view.container.textContent).toContain("Account rows");
  undo();
  await view.unmount();
});

function Limit() {
  const { limit, hideUnrated } = useViewingLimit();
  return <p data-unrated={hideUnrated}>{limit ?? "none"}</p>;
}

test("the profile's own limit wins over the Browsing setting, which then reads 'Set in the profile'", async () => {
  await act(async () => setPrefs({ viewingLimit: 16 }, { quiet: true }));
  const view = await render(
    <>
      <Limit />
      <LimitFromProfile />
    </>,
  );
  expect(view.container.querySelector("p")!.textContent).toBe("16");
  await act(async () => setActiveLock({ pin: null, viewingLimit: 9, hideUnrated: true }));
  expect(view.container.querySelector("p")!.textContent).toBe("9");
  expect(view.container.querySelector("p")!.dataset.unrated).toBe("true");
  expect(view.container.textContent).toContain("Set in the profile");
  await act(async () => setActiveLock(null));
  expect(view.container.querySelector("p")!.textContent).toBe("16");
  await view.unmount();
});
