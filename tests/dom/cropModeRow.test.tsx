import { expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingRow } from "../../src/components/settings/SettingRow";
import { getPrefs, setPrefs } from "../../src/lib/settings/prefs";
import { click, render } from "./render";

const withClient = (node: ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;

test("Settings → Advanced's Crop shows the mode the player's button chose, and leaves out Crop black bars without mpv (#330)", async () => {
  setPrefs({ cropMode: "fit" });
  const { container, unmount } = await render(withClient(<SettingRow id="cropMode" />));
  const shown = () => container.querySelector("[data-setting=cropMode]")?.textContent ?? "";
  expect(shown()).toContain("Fit");
  // The player's button (or its shortcut) stores the next mode: the row follows.
  await act(async () => setPrefs({ cropMode: "fill" }));
  expect(shown()).toContain("Fill window");
  await unmount();

  // Without mpv the choices are Fit and Fill window; Crop black bars still shows while it's the stored one.
  const { container: noMpv, unmount: done } = await render(withClient(<SettingRow id="cropMode" omit={["bars"]} />));
  await click(noMpv.querySelector("[data-setting=cropMode] button, [data-setting=cropMode] [role=combobox]"));
  const list = [...document.querySelectorAll("[role=option]")].map((o) => o.textContent?.trim());
  expect(list).toEqual(["Fit", "Fill window"]);
  expect(getPrefs().cropMode).toBe("fill");
  await done();
});
