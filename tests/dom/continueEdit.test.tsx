import { expect, test } from "bun:test";
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

async function mount() {
  const removed: Progress[][] = [];
  const view = await render(
    <ContinueEditRow
      items={items}
      order={items.map((p) => p.videoId).join(" ")}
      card={(p) => <button className="test-card">{p.name}</button>}
      remove={(entries) => removed.push(entries)}
    />,
  );
  const boxes = () => [...view.container.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  const button = (text: string) => byText(view.container, "button", text);
  const removeButton = () => [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Remove ("))!;
  return { ...view, removed, boxes, button, removeButton };
}

test("Continue Watching: Edit turns the cards into checkboxes, and Remove takes the picked ones", async () => {
  const { container, removed, boxes, button, removeButton, unmount } = await mount();
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
  expect(removeButton().textContent).toBe("Remove (1)");

  await click(removeButton());
  expect(removed).toEqual([[items[1]]]);
  // Removing leaves Edit, focus back on its button.
  expect(boxes()).toHaveLength(0);
  expect(document.activeElement?.textContent).toBe("Edit");
  await unmount();
});

test("Continue Watching: Select All picks every card, then reads Deselect All", async () => {
  const { removed, boxes, button, removeButton, unmount } = await mount();
  await click(button("Edit"));
  await click(button("Select All"));
  expect(boxes().every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
  expect(removeButton().textContent).toBe("Remove (3)");
  await click(button("Deselect All"));
  expect(removeButton().textContent).toBe("Remove (0)");
  await click(button("Select All"));
  await click(removeButton());
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
