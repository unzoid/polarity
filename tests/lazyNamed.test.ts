import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { canPreloadChunks, lazyNamed } from "../src/lib/ui/lazy";

describe("lazyNamed", () => {
  test("renders resolved component synchronously after preload() settles (no Suspense microtask)", async () => {
    const Target = ({ label }: { label: string }) => createElement("span", null, label);
    let loads = 0;
    const Lazy = lazyNamed(async () => {
      loads++;
      return { Target };
    }, "Target");

    await Lazy.preload();
    expect(loads).toBe(1);

    // Calling the wrapper function directly after preload returns an element for Target,
    // not React.lazy's exotic wrapper (which would suspend on first render and trip React 19's 300ms throttle).
    const el = (Lazy as unknown as (props: { label: string }) => { type: unknown; props: { label: string } })({ label: "ok" });
    expect(el.type).toBe(Target);
    expect(el.props.label).toBe("ok");
  });

  test("retries load after a rejected preload", async () => {
    const Target = () => null;
    let attempts = 0;
    const Lazy = lazyNamed(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return { Target };
    }, "Target");

    await expect(Lazy.preload()).rejects.toThrow("transient");
    await Lazy.preload();
    expect(attempts).toBe(2);
    const el = (Lazy as unknown as (props: Record<string, never>) => { type: unknown })({});
    expect(el.type).toBe(Target);
  });
});

describe("canPreloadChunks", () => {
  test("allows local app origins even when browser reports low downlink", () => {
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      (globalThis as { window?: unknown }).window = { location: { protocol: "http:", hostname: "localhost" } };
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { connection: { saveData: false, effectiveType: "4g", downlink: 1.3 } },
      });
      expect(canPreloadChunks()).toBe(true);

      (globalThis as { window?: unknown }).window = { location: { protocol: "http:", hostname: "tauri.localhost" } };
      expect(canPreloadChunks()).toBe(true);

      (globalThis as { window?: unknown }).window = { location: { protocol: "https:", hostname: "app.example.com" } };
      expect(canPreloadChunks()).toBe(true);

      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { connection: { saveData: true, effectiveType: "4g", downlink: 10 } },
      });
      expect(canPreloadChunks()).toBe(false);

      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { connection: { saveData: false, effectiveType: "3g", downlink: 1.5 } },
      });
      expect(canPreloadChunks()).toBe(false);
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
      if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
    }
  });
});
