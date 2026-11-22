import { afterEach, expect, test } from "bun:test";
import { createAgent } from "@ui-sdk/react/agent";
import { act } from "react";
import { ListDialog } from "../../src/desk/ListDialog";
import { byText, click, press, render, unmountRendered } from "./render";

const GENRES = ["Action", "Comedy", "Drama"].map((g) => ({ id: g, label: g }));
const agent = createAgent();

afterEach(unmountRendered);

async function open(value?: string) {
  const picked: string[] = [];
  let closed = 0;
  await render(<ListDialog open label="Categories" options={GENRES} value={value} onPick={(id) => picked.push(id)} onClose={() => closed++} />);
  return { picked, closed: () => closed };
}

test("the chooser is a dialog named for what it chooses, with focus on the choice in use", async () => {
  await open("Comedy");
  const dialog = document.querySelector<HTMLElement>("[data-slot='dialog-content']");
  expect(dialog?.getAttribute("role")).toBe("dialog");
  const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
  expect(title?.textContent).toBe("Categories");
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(document.activeElement?.textContent).toBe("Comedy");
  expect(byText(document, "button", "Comedy").getAttribute("aria-current")).toBe("true");
});

test("a choice is picked by a click, and Escape or the round ✕ closes it", async () => {
  const { picked, closed } = await open();
  await click(byText(document, "button", "Drama"));
  expect(picked).toEqual(["Drama"]);
  await press("Escape", document.querySelector("[data-slot='dialog-content']")!);
  expect(closed()).toBe(1);
  await click(document.querySelector("[aria-label='Close']"));
  expect(closed()).toBe(2);
});

test("an agent finds the chooser and its Close by name", async () => {
  await open("Action");
  const entries = agent.snapshot().filter((e) => !e.offPage && e.component !== "more");
  for (const e of entries) expect(e.label, `${e.component} ${e.ref} has no name`).toBeTruthy();
  expect(entries.map((e) => e.label)).toContain("Categories");
});
