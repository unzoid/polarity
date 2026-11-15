import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { ContinueEditRow } from "../../src/components/ContinueEditRow";
import type { Progress } from "../../src/lib/types";
import { byText, click, press, render } from "./render";

const entry = (n: number): Progress => ({
  metaId: `tt000000${n}`,
  videoId: `tt000000${n}`,
  type: "movie",
  name: `Film ${n}`,
  position: 30,
  duration: 100,
  updatedAt: n,
});
const items = [1, 2, 3].map(entry);

const realMatchMedia = window.matchMedia;
afterEach(() => void (window.matchMedia = realMatchMedia));

/** A touch screen (Edit is a button) or, by default here, a keyboard and mouse (Shift held selects). */
async function mount({ touch = true } = {}) {
  window.matchMedia = ((q: string) => ({ matches: touch && q === "(pointer: coarse)", media: q })) as unknown as typeof window.matchMedia;
  const removed: Progress[][] = [];
  const view = await render(
    <ContinueEditRow
      items={items}
      order={items.map((p) => p.videoId).join(" ")}
      card={(p) => <button className="test-card">{p.name}</button>}
      remove={(entries) => removed.push(entries)}
    />,
  );
  // The checkboxes and the bar are always there; out of use they're inert.
  const boxes = () => [...view.container.querySelectorAll<HTMLElement>('[role="checkbox"]:not([inert])')];
  const button = (text: string) =>
    [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === text || b.textContent?.trim() === text) ??
    byText(view.container, "button", text);
  const removeButton = () => [...view.container.querySelectorAll<HTMLButtonElement>("button.confirm-delete")][0];
  /** Remove asks twice: the first click opens the bin's lid. */
  const removeTwice = async () => {
    await click(removeButton());
    expect(removeButton().getAttribute("aria-label")).toBe("Click again to remove");
    await click(removeButton());
  };
  return { ...view, removed, boxes, button, removeButton, removeTwice };
}

test("Continue Watching: Edit turns the cards into checkboxes, and Remove takes the picked ones", async () => {
  const { container, removed, boxes, button, removeButton, removeTwice, unmount } = await mount();
  expect(boxes()).toHaveLength(0);
  expect(container.querySelectorAll(".test-card")).toHaveLength(3);

  await click(button("Edit"));
  expect(boxes()).toHaveLength(3);
  expect(boxes()[0].getAttribute("aria-label")).toBe("Film 1");
  // The card goes inert: a click picks it rather than opening it.
  expect(container.querySelector(".test-card")!.closest("[inert]")).not.toBeNull();
  expect(removeButton().disabled).toBe(true);

  await click(boxes()[1]);
  expect(boxes()[1].getAttribute("aria-checked")).toBe("true");
  expect(removeButton().getAttribute("aria-label")).toBe("Remove 1 from Continue Watching");

  await removeTwice();
  expect(removed).toEqual([[items[1]]]);
  // Removing leaves Edit, focus back on its button.
  expect(boxes()).toHaveLength(0);
  expect(document.activeElement?.textContent).toBe("Edit");
  await unmount();
});

test("Continue Watching: Select All picks every card, then reads Deselect All", async () => {
  const { removed, boxes, button, removeButton, removeTwice, unmount } = await mount();
  await click(button("Edit"));
  await click(button("Select All"));
  expect(boxes().every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
  expect(removeButton().getAttribute("aria-label")).toBe("Remove 3 from Continue Watching");
  await click(button("Deselect All"));
  expect(removeButton().disabled).toBe(true);
  await click(button("Select All"));
  await removeTwice();
  expect(removed).toEqual([items]);
  await unmount();
});

test("Continue Watching: Done and Escape leave Edit without removing anything", async () => {
  const { removed, boxes, button, unmount } = await mount();
  await click(button("Edit"));
  await click(boxes()[0]);
  await click(button("Done"));
  expect(boxes()).toHaveLength(0);

  await click(button("Edit"));
  // Nothing carried over from last time.
  expect(boxes().some((b) => b.getAttribute("aria-checked") === "true")).toBe(false);
  boxes()[0].focus();
  await press("Escape");
  expect(boxes()).toHaveLength(0);
  expect(removed).toEqual([]);
  await unmount();
});

const shift = (type: "keydown" | "keyup") => act(async () => void window.dispatchEvent(new KeyboardEvent(type, { key: "Shift" })));

test("Continue Watching with a keyboard: Shift held shows the checkboxes; a pick keeps them after it's let go", async () => {
  const { container, removed, boxes, button, removeButton, removeTwice, unmount } = await mount({ touch: false });
  expect(container.querySelector(".cw-edit-open")).toBeNull();
  expect(container.querySelector(".cw-edit-hint")?.textContent).toBe("Hold Shift to select");

  // Held and let go with nothing picked: back as it was.
  await shift("keydown");
  expect(boxes()).toHaveLength(3);
  await shift("keyup");
  expect(boxes()).toHaveLength(0);

  // A pick while it's held stays, with the bar, until Remove.
  await shift("keydown");
  await click(boxes()[2]);
  await shift("keyup");
  expect(boxes()).toHaveLength(3);
  expect(removeButton().getAttribute("aria-label")).toBe("Remove 1 from Continue Watching");
  await removeTwice();
  expect(removed).toEqual([[items[2]]]);
  expect(boxes()).toHaveLength(0);

  // Done leaves it too.
  await shift("keydown");
  await click(boxes()[0]);
  await shift("keyup");
  await click(button("Done"));
  expect(boxes()).toHaveLength(0);
  await unmount();
});
