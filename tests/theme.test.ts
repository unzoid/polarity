import { expect, test } from "bun:test";
import {
  accentForeground,
  baseFor,
  copyName,
  fromCustom,
  LIGHT_BASE,
  PRESET_THEMES,
  resolveScheme,
  resolveTheme,
  themeBackground,
  themeList,
} from "../src/lib/theme/themes";
import type { CustomTheme } from "../src/lib/types";

const settings = (theme: string, customThemes: CustomTheme[] = [], accentColor = "#0A84FF") => ({ theme, customThemes, accentColor });
const mine: CustomTheme = { id: "abc", name: "Night shift", accent: "#30d158", base: "#0A0A0A", tint: 3 };

test("Polar, indigo on plain grey, is the default", () => {
  expect(resolveTheme(settings("polar"))).toMatchObject({ id: "polar", accent: "#5E5CE6", base: "#0a0a0a", tint: 0 });
  expect(resolveTheme(settings("no-such-theme")).id).toBe("polar");
});

test("settings from before themes become Polar or OLED", () => {
  expect(resolveTheme(settings("dark")).id).toBe("polar");
  expect(resolveTheme(settings("black")).id).toBe("oled");
  expect(themeList(settings("black")).length).toBe(PRESET_THEMES.length);
});

test("an accent picked before themes is kept, as its own tile", () => {
  const s = settings("black", [], "#FF375F");
  expect(resolveTheme(s)).toMatchObject({ id: "black", name: "Your colours", accent: "#FF375F", base: "#000000" });
  expect(themeList(s)[0].id).toBe("black");
  // Once a theme is chosen, it's gone.
  expect(themeList(settings("ember", [], "#FF375F")).some((t) => t.name === "Your colours")).toBe(false);
});

test("a custom theme is chosen by its id, its values normalised", () => {
  expect(resolveTheme(settings("custom:abc", [mine]))).toMatchObject({ id: "custom:abc", custom: true, accent: "#30D158", base: "#0a0a0a" });
  // Deleted on another device: back to Polar.
  expect(resolveTheme(settings("custom:abc", [])).id).toBe("polar");
});

test("custom themes from elsewhere are checked before use", () => {
  expect(fromCustom({ ...mine, accent: "red" })).toBeNull();
  expect(fromCustom({ ...mine, base: "#ffffff" })).toBeNull(); // light: the app's text would vanish
  expect(fromCustom({ ...mine, name: "   " })).toBeNull();
  expect(fromCustom({ ...mine, tint: 80 })?.tint).toBe(10);
  expect(fromCustom({ ...mine, tint: Number.NaN })?.tint).toBe(0);
  expect(fromCustom(null)).toBeNull();
});

test("copies get a name no theme has", () => {
  const themes = themeList(settings("polar", [{ ...mine, name: "Polar copy" }]));
  expect(copyName("Polar", themes)).toBe("Polar copy 2");
  expect(copyName("Polar copy", themes)).toBe("Polar copy 2");
  expect(copyName("Ember", themes)).toBe("Ember copy");
});

test("light accents get dark text; the page colour is the base tinted", () => {
  expect(accentForeground("#FFD60A")).toBe("#0b0b0b");
  expect(accentForeground("#5E5CE6")).toBe("#fff");
  expect(themeBackground({ accent: "#5E5CE6", base: "#0a0a0a", tint: 0 })).toBe("#0a0a0a");
  expect(themeBackground({ accent: "#ffffff", base: "#000000", tint: 10 })).toBe("#1a1a1a");
});

test("the colour scheme: dark by default, light, or the system's", () => {
  expect(resolveScheme(undefined, true)).toBe("dark");
  expect(resolveScheme("dark", true)).toBe("dark");
  expect(resolveScheme("light", false)).toBe("light");
  expect(resolveScheme("system", true)).toBe("light");
  expect(resolveScheme("system", false)).toBe("dark");
  expect(resolveScheme("sepia", true)).toBe("dark");
});

test("light mode keeps a theme's accent and tint on a near-white; OLED's black becomes white", () => {
  const polar = PRESET_THEMES.find((t) => t.id === "polar")!;
  const oled = PRESET_THEMES.find((t) => t.id === "oled")!;
  const dune = PRESET_THEMES.find((t) => t.id === "dune")!;
  expect(baseFor(polar, "dark")).toBe("#0a0a0a");
  expect(baseFor(polar, "light")).toBe(LIGHT_BASE);
  expect(baseFor(dune, "light")).toBe(LIGHT_BASE);
  expect(baseFor(oled, "light")).toBe("#ffffff");
  expect(themeBackground(polar, "light")).toBe(LIGHT_BASE);
});
