import { expect, test } from "bun:test";
import { act } from "react";
import { FamilyPickerTray, FamilyResetTray } from "../../src/components/settings/FamilyTray";
import { click, press, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

test("FamilyPickerTray: opens with choices, picks a value, and Escape closes it", async () => {
  let picked: string | null = null;
  let closed = 0;
  const { unmount } = await render(
    <FamilyPickerTray
      open
      onClose={() => closed++}
      title="Notification pace"
      value="balanced"
      options={[
        { value: "quiet", label: "Quiet" },
        { value: "balanced", label: "Balanced" },
        { value: "all", label: "All" },
      ]}
      onPick={(v) => {
        picked = v;
      }}
    />,
  );
  await settle();
  const dialog = document.querySelector<HTMLElement>("[role=dialog][aria-label='Notification pace']")!;
  expect(dialog).not.toBeNull();

  const radios = [...dialog.querySelectorAll<HTMLButtonElement>("[role=radio]")];
  expect(radios.map((r) => r.textContent?.trim())).toEqual(["Quiet", "Balanced", "All"]);
  expect(radios[1].getAttribute("aria-checked")).toBe("true");

  await click(radios[0]);
  expect(picked).toBe("quiet");

  const done = [...dialog.querySelectorAll<HTMLButtonElement>(".ft-pill")].find((b) => b.textContent?.trim() === "Done")!;
  expect(done).not.toBeNull();

  await press("Escape", document.body);
  expect(closed).toBeGreaterThanOrEqual(1);

  await unmount();
});

test("FamilyResetTray: morphs from Restore Defaults to Confirm Reset and runs reset after hold", async () => {
  let resets = 0;
  let closed = 0;
  const { unmount } = await render(
    <FamilyResetTray
      open
      onClose={() => closed++}
      onConfirmReset={() => resets++}
    />,
  );
  await settle();
  const continueBtn = [...document.querySelectorAll<HTMLButtonElement>(".ft-pill")].find((b) => b.textContent?.trim() === "Continue")!;
  expect(continueBtn).not.toBeNull();
  await click(continueBtn);
  await settle();

  const holdBtn = [...document.querySelectorAll<HTMLButtonElement>(".ft-pill")].find((b) => b.textContent?.includes("Hold to Reset"))!;
  expect(holdBtn).not.toBeNull();

  // Trigger via keyboard hold (Enter) and wait for completion
  await act(async () => {
    holdBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 1250));
  });
  expect(resets).toBe(1);

  const doneBtn = [...document.querySelectorAll<HTMLButtonElement>(".ft-pill")].find((b) => b.textContent?.trim() === "Done")!;
  expect(doneBtn).not.toBeNull();
  await click(doneBtn);
  expect(closed).toBe(1);
  await unmount();
});
