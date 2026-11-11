import { expect, test } from "bun:test";

// TitleLogo reads pictures through the app (lib/api), which loads the stored settings.
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { toneUrl } = await import("../src/components/TitleLogo");

test("logos and backdrops are measured off their own URL, TMDB's at a small size", () => {
  expect(toneUrl("https://image.tmdb.org/t/p/w500/abc.png")).toBe("https://image.tmdb.org/t/p/w185/abc.png?tone=1");
  expect(toneUrl("https://image.tmdb.org/t/p/original/abc.jpg")).toBe("https://image.tmdb.org/t/p/w185/abc.jpg?tone=1");
  expect(toneUrl("https://images.metahub.space/logo/medium/tt0000000/img")).toBe("https://live.metahub.space/logo/medium/tt0000000/img?tone=1");
  expect(toneUrl("https://media.example.com/logo.png")).toBe("https://media.example.com/logo.png?tone=1");
  expect(toneUrl("not a url")).toBe("not a url");
});
