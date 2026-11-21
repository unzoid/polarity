import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { PauseScreen } from "../../src/components/player/PauseScreen";
import { TvKeyboard } from "../../src/tv/TvKeyboard";
import type { Person } from "../../src/lib/types";
import { render } from "./render";

afterEach(() => {
  localStorage.clear();
});

test("PauseScreen makes cast members with a tmdbId clickable to open their Person page", async () => {
  const picked: Person[] = [];
  const { container, unmount } = await render(
    <PauseScreen
      allowed
      after={0}
      details={{
        name: "Example Film",
        overview: "A test overview.",
        cast: [
          { name: "Ada Example", character: "Captain", tmdbId: 42 },
          { name: "Unlinked Actor", character: "Extra" },
        ],
      }}
      onSelectPerson={(p) => picked.push(p)}
    />,
  );
  await act(async () => new Promise((r) => setTimeout(r, 20)));

  const btn = container.querySelector<HTMLButtonElement>(".pause-screen-person-btn");
  expect(btn).not.toBeNull();
  expect(btn!.getAttribute("aria-label")).toBe("View Ada Example");
  // Unlinked cast member stays non-interactive
  expect(container.querySelectorAll(".pause-screen-person-btn").length).toBe(1);

  await act(async () => {
    btn!.click();
  });
  expect(picked).toHaveLength(1);
  expect(picked[0]!.tmdbId).toBe(42);
  await unmount();
});

test("TvKeyboard defaults to QWERTY, toggles to ABC with persistence, and supports URL characters", async () => {
  let value = "";
  const { container, unmount } = await render(
    <TvKeyboard
      text={value}
      onChange={(next) => {
        value = next;
      }}
      placeholder="https://addon.example.com/manifest.json"
      active
      url
    />,
  );

  const grid = container.querySelector<HTMLElement>(".tv-osk-keys")!;
  expect(grid.dataset.layout).toBe("qwerty");
  // URL extra keys are present
  const labels = [...grid.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toContain(":");
  expect(labels).toContain("/");
  expect(labels).toContain(".");

  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Switch to A-Z keyboard"]')!;
  expect(toggle).not.toBeNull();
  await act(async () => {
    toggle.click();
  });
  expect(grid.dataset.layout).toBe("abc");
  expect(localStorage.getItem("polar.tvKeyboardLayout")).toBe("abc");

  await unmount();
});
