import { expect, test } from "bun:test";
import { ACCENT_THEME, accentForeground, accentName, baseFor, DEFAULT_ACCENT, LIGHT_BASE, resolveAccent, resolveScheme } from "../src/lib/theme/themes";
import type { CustomTheme } from "../src/lib/types";

const settings = (theme: string, accentColor = "#0A84FF", customThemes: CustomTheme[] = []) => ({ theme, accentColor, customThemes });

test("indigo is the default accent", () => {
  expect(DEFAULT_ACCENT).toBe("#5E5CE6");
  expect(resolveAccent(settings("polar"))).toBe(DEFAULT_ACCENT);
  expect(resolveAccent(settings("no-such-theme"))).toBe(DEFAULT_ACCENT);
});

test("a picked accent is used, upper-cased, and a broken one falls back", () => {
  expect(resolveAccent(settings(ACCENT_THEME, "#30d158"))).toBe("#30D158");
  expect(resolveAccent(settings(ACCENT_THEME, "red"))).toBe(DEFAULT_ACCENT);
});

test("a device that had a theme keeps its accent", () => {
  expect(resolveAccent(settings("rose"))).toBe("#FF375F");
  expect(resolveAccent(settings("dune"))).toBe("#E3B26A");
  const mine: CustomTheme = { id: "abc", name: "Night shift", accent: "#30d158", base: "#0A0A0A", tint: 3 };
  expect(resolveAccent(settings("custom:abc", "#0A84FF", [mine]))).toBe("#30D158");
  // Deleted on another device, or not a colour: the default.
  expect(resolveAccent(settings("custom:abc"))).toBe(DEFAULT_ACCENT);
  expect(resolveAccent(settings("custom:abc", "#0A84FF", [{ ...mine, accent: "red" }]))).toBe(DEFAULT_ACCENT);
});

test("settings from before themes keep an accent picked then", () => {
  expect(resolveAccent(settings("black", "#FF375F"))).toBe("#FF375F");
  // The old default blue was never picked.
  expect(resolveAccent(settings("dark", "#0A84FF"))).toBe(DEFAULT_ACCENT);
});

test("accent names, and dark text on light accents", () => {
  expect(accentName("#5e5ce6")).toBe("Indigo");
  expect(accentName("#123456")).toBe("Custom");
  expect(accentForeground("#FFD60A")).toBe("#0b0b0b");
  expect(accentForeground("#5E5CE6")).toBe("#fff");
});

test("the colour scheme: dark by default, light, or the system's", () => {
  expect(resolveScheme(undefined, true)).toBe("dark");
  expect(resolveScheme("dark", true)).toBe("dark");
  expect(resolveScheme("light", false)).toBe("light");
  expect(resolveScheme("system", true)).toBe("light");
  expect(resolveScheme("system", false)).toBe("dark");
  expect(resolveScheme("sepia", true)).toBe("dark");
  expect(baseFor("dark")).toBe("#0a0a0a");
  expect(baseFor("light")).toBe(LIGHT_BASE);
});
