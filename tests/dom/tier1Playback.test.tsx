import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OptionsOverlay } from "../../src/components/player/OptionsOverlay";
import { SkipButton, type ActiveSkip } from "../../src/components/player/SkipSegments";
import { usePlayerKeyboard } from "../../src/components/player/usePlayerKeyboard";
import { useSource } from "../../src/components/player/useSource";
import { api } from "../../src/lib/api";
import { autoPickOrder, forgetPlayerSourceChoices, rememberBingeGroup } from "../../src/lib/playback/sources";
import { warmLinks } from "../../src/lib/playback/readiness";
import type { RankedStream, Readiness, StreamsResult } from "../../src/lib/types";
import { render } from "./render";

const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));
const makeStream = (url: string, opts?: { resolution?: number; bingeGroup?: string; addon?: string }): RankedStream => ({
  stream: { url, ...(opts?.bingeGroup ? { behaviorHints: { bingeGroup: opts.bingeGroup } } : {}) },
  addon: opts?.addon ?? "Example Add-on",
  quality: {
    resolution: opts?.resolution ?? 1080,
    hdr: false,
    dolbyVision: false,
    lowQualitySource: false,
    direct: true,
    languages: [],
    tags: [],
  },
  label: `${opts?.resolution ?? 1080}p`,
});

afterEach(() => {
  forgetPlayerSourceChoices();
  jest.useRealTimers();
});

test("useSource automatically falls over to candidate #2 when candidate #1 fails to resolve", async () => {
  const broken = "https://media.example.com/broken.mkv";
  const good = "https://media.example.com/good.mkv";
  const result: StreamsResult = {
    streams: [makeStream(broken, { resolution: 1080 }), makeStream(good, { resolution: 720 })],
    failed: [],
    asked: ["Example Add-on"],
    ids: ["tt0000010:1:1"],
  };
  const resolved: string[] = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { stream?: { url?: string } }) => {
      if (cmd === "streams") return result;
      if (cmd === "progress_for") return [];
      if (cmd === "downloads_list") return [];
      if (cmd === "resolve_stream") {
        const url = args.stream?.url ?? "";
        resolved.push(url);
        if (url === broken) return { kind: "unsupported", reason: "Broken source" };
        return { kind: "url", url };
      }
      return null;
    },
  };
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const noop = () => {};
    let state: ReturnType<typeof useSource>["state"] | undefined;
    function Probe() {
      state = useSource("series", "tt0000010", "tt0000010:1:1", undefined, undefined, noop).state;
      return null;
    }
    const view = await render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    await settle(60);
    expect(resolved).toEqual([broken, good]);
    expect(state).toMatchObject({ status: "ready", url: good });
    await view.unmount();
  } finally {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
});

test("autoPickOrder demotes known notReady links and prefers the active bingeGroup", async () => {
  const deadUrl = "https://media.example.com/dead-4k.mkv";
  const otherUrl = "https://media.example.com/other-4k.mkv";
  const bingeUrl = "https://media.example.com/binge-1080.mkv";
  const spy = spyOn(api, "streamReady").mockImplementation(async (url: string): Promise<Readiness> =>
    url === deadUrl ? { state: "notReady", reason: "Not ready at the source" } : { state: "ready", ms: 200 },
  );
  try {
    const dead = makeStream(deadUrl, { resolution: 2160 });
    const other = makeStream(otherUrl, { resolution: 2160, bingeGroup: "group-a" });
    const binge = makeStream(bingeUrl, { resolution: 1080, bingeGroup: "group-b" });
    const stop = warmLinks([dead, other, binge]);
    await new Promise((r) => setTimeout(r, 30));
    stop();

    // Without bingeGroup, the working 4K beats the dead 4K.
    const withoutBinge = autoPickOrder([dead, other, binge], undefined, "tt0000020");
    expect(withoutBinge[0]!.stream.url).toBe(otherUrl);
    expect(withoutBinge[withoutBinge.length - 1]!.stream.url).toBe(deadUrl);

    // With bingeGroup remembered for the show, matching group wins while dead stays last.
    rememberBingeGroup("tt0000020", "group-b");
    const withBinge = autoPickOrder([dead, other, binge], undefined, "tt0000020");
    expect(withBinge[0]!.stream.url).toBe(bingeUrl);
    expect(withBinge[withBinge.length - 1]!.stream.url).toBe(deadUrl);
  } finally {
    spy.mockRestore();
  }
});

test("SkipButton offers a Cancel button during auto-skip countdown that cancels without skipping", async () => {
  const intro: ActiveSkip = { kind: "intro", label: "Skip Intro", span: { start: 10, end: 90 } };
  let skipped = 0;
  let cancelled = 0;
  const { container, unmount } = await render(
    <SkipButton
      active={intro}
      onSkip={() => skipped++}
      onCancel={() => cancelled++}
      chromeVisible={false}
      countdown={5}
    />,
  );
  const cancelBtn = container.querySelector<HTMLButtonElement>(".skip-cancel");
  expect(cancelBtn).not.toBeNull();
  await act(async () => cancelBtn!.click());
  expect(cancelled).toBe(1);
  expect(skipped).toBe(0);
  await unmount();
});

test("OptionsOverlay live mode leaves the playing video clear with no frosted backdrop", async () => {
  const { container, unmount } = await render(
    <OptionsOverlay
      open
      live
      media={null}
      onClose={() => {}}
      columns={[{ title: "Audio", options: [{ id: "en", label: "English" }], value: "en", onSelect: () => {} }]}
    />,
  );
  const root = container.querySelector(".options-overlay")!;
  expect(root.getAttribute("data-live")).toBe("true");
  expect(container.querySelector(".video-backdrop")).toBeNull();
  expect(container.querySelector(".options-shade")).toBeNull();
  await unmount();
});

test("usePlayerKeyboard ignores key repeat on discrete toggles while allowing continuous seek/volume repeat", async () => {
  const fired: string[] = [];
  function Keys() {
    usePlayerKeyboard(
      true,
      (action) => {
        fired.push(action);
        return true;
      },
      () => {},
    );
    return null;
  }
  const { unmount } = await render(<Keys />);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: false, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", repeat: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", repeat: true, cancelable: true }));
  });
  expect(fired).toEqual(["playPause", "seekForward", "volumeUp"]);
  await unmount();
});
