import { expect, test } from "bun:test";
import { act } from "react";
import { useKeyboardFocus } from "../../src/components/player/useKeyboardFocus";
import { usePlayerKeyboard } from "../../src/components/player/usePlayerKeyboard";
import { press, render } from "./render";

// The player's focus ring only for focus the keyboard moved (#329).

function Controls() {
  const keyFocus = useKeyboardFocus();
  return (
    <div data-testid="player" data-key-focus={keyFocus || undefined}>
      <button>Fill window</button>
      <button>Next</button>
    </div>
  );
}

const player = () => document.querySelector("[data-testid='player']")!;
const [fill, next] = [0, 1].map((i) => () => document.querySelectorAll("button")[i] as HTMLButtonElement);
// A click as a mouse makes it: the press, then the focus, then the click.
const mouseClick = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.focus();
    el.click();
  });
// A Tab as the browser makes it: the key, then the focus moving.
const tabTo = (el: HTMLElement) =>
  act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    el.focus();
  });

test("a click never counts as keyboard focus, nor a key that doesn't move the focus; Tab does, until the next click", async () => {
  const { unmount } = await render(<Controls />);
  await mouseClick(fill());
  expect(player().hasAttribute("data-key-focus")).toBe(false);
  // The clicked button's shortcut: the focus stays put.
  await press("z");
  expect(player().hasAttribute("data-key-focus")).toBe(false);
  await tabTo(next());
  expect(player().hasAttribute("data-key-focus")).toBe(true);
  await press("z");
  expect(player().hasAttribute("data-key-focus")).toBe(true);
  await mouseClick(fill());
  expect(player().hasAttribute("data-key-focus")).toBe(false);
  await unmount();
});

test("a key bound to nothing reaches the player as another key; a shortcut doesn't", async () => {
  const seen: string[] = [];
  function Keys() {
    usePlayerKeyboard(
      true,
      (a) => a === "fill",
      (a) => seen.push(a),
      () => seen.push("other"),
    );
    return null;
  }
  const { unmount } = await render(<Keys />);
  await press("z");
  await press("Tab");
  expect(seen).toEqual(["fill", "other"]);
  await unmount();
});
