import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PolarityExport } from "../../src/components/settings/PolarityExport";
import { isDesktop } from "../../src/lib/platform";
import { byText, click, render } from "./render";

// An invented export, as crates/library/src/export.rs writes it.
const EXPORT = JSON.stringify({
  app: "polarity",
  version: 1,
  exportedAt: 1000,
  library: [{ id: "tt0000001", type: "movie", name: "Paper Moons", addedAt: 100 }],
  progress: [{ metaId: "tt0000001", videoId: "tt0000001", type: "movie", name: "Paper Moons", position: 10, duration: 20, updatedAt: 300 }],
  animeLinks: [],
  playlists: [],
});

const calls: [string, Record<string, unknown>][] = [];
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "library_import" || cmd === "library_export") calls.push([cmd, args]);
    if (cmd === "library_import") return { library: 1, progress: 1 };
    if (cmd === "library_export") return `polarity-library-2026-01-01.${args.format}`;
    return null;
  },
};
afterAll(() => void delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

async function choose(container: HTMLElement, text: string, name: string) {
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: [new File([text], name, { type: "application/json" })], configurable: true });
  await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
}

test("Import a Polarity export: the file goes through the library import and the notice says what was added", async () => {
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <PolarityExport />
    </QueryClientProvider>,
  );
  await choose(container, EXPORT, "backup.json");
  const imported = calls.find(([cmd]) => cmd === "library_import")![1] as { progress: { videoId: string }[] };
  expect(imported.progress.map((p) => p.videoId)).toEqual(["tt0000001"]);
  expect(container.textContent).toContain("backup.json: Added 1 library title and 1 history entry.");

  calls.length = 0;
  await choose(container, JSON.stringify({ app: "polarity", version: 9 }), "future.json");
  expect(calls).toEqual([]);
  expect(container.querySelector(".settings-error")?.textContent).toBe("future.json: This export is from a newer version of Polarity. Update Polarity to import it.");

  if (isDesktop) {
    const row = byText(container, ".settings-row-title", "Watch history as CSV");
    await click(row.parentElement!.parentElement!.querySelector("button"));
    await settle();
    expect(calls.at(-1)).toEqual(["library_export", { format: "csv", playlists: [] }]);
    expect(container.textContent).toContain("Saved polarity-library-2026-01-01.csv.");
  }
  unmount();
});
