import { afterEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import { PauseScreen } from "../../src/components/player/PauseScreen";
import { Scrubber } from "../../src/components/player/Scrubber";
import type { MediaLike } from "../../src/components/player/mpvMedia";
import { PinPad } from "../../src/components/profileLock/PinPad";
import { PAUSE_SCREEN_AFTER_MS, PAUSE_SCREEN_EXIT_MS, type PauseDetails } from "../../src/lib/playback/pauseScreen";
import type { Entry } from "../../src/lib/router";
import { cardOrigin, skipNextPageMotion, usePageMotion, watchCardTaps, type PageMotion } from "../../src/lib/ui/pageMotion";
import { byText, click, press, render } from "./render";

afterEach(() => {
  jest.useRealTimers();
  delete document.documentElement.dataset.reduceMotion;
});

class FakeMedia extends EventTarget implements MediaLike {
  currentTime = 0;
  duration: number;
  paused = true;
  ended = false;
  readyState = 4;
  volume = 1;
  muted = false;
  playbackRate = 1;
  buffered: TimeRanges = {
    length: 0,
    start: () => 0,
    end: () => 0,
  };

  constructor(duration = 1200) {
    super();
    this.duration = duration;
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

const nextFrames = (count = 2) =>
  act(async () => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });

describe("PinPad 4th dot persistence and 3x4 directional navigation", () => {
  test("4th PIN dot renders data-filled=\"true\" immediately on the 4th digit and clears only when failures increments", async () => {
    const completed: string[] = [];
    const view = await render(<PinPad label="Enter PIN" failures={0} onComplete={(pin) => completed.push(pin)} />);

    const dots = () => [...view.container.querySelectorAll<HTMLElement>(".pin-dot")];

    await click(byText(view.container, "button", "2"));
    await click(byText(view.container, "button", "4"));
    await click(byText(view.container, "button", "6"));
    expect(dots().map((d) => d.getAttribute("data-filled"))).toEqual(["true", "true", "true", null]);
    expect(completed).toEqual([]);

    await click(byText(view.container, "button", "8"));
    expect(completed).toEqual(["2468"]);
    // All four dots remain lit with data-filled="true" while verification runs.
    expect(dots().map((d) => d.getAttribute("data-filled"))).toEqual(["true", "true", "true", "true"]);
    expect(view.container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Enter PIN: 4 of 4 digits");

    // Incrementing failures shakes and resets all four dots.
    await view.rerender(<PinPad label="Enter PIN" failures={1} onComplete={(pin) => completed.push(pin)} />);
    expect(view.container.querySelector(".pin-dots")?.getAttribute("data-shake")).toBe("true");
    expect(dots().every((d) => d.getAttribute("data-filled") === null)).toBe(true);
    await view.unmount();
  });

  test("ArrowRight, ArrowDown, ArrowLeft and ArrowUp move focus cleanly across digits, 0 and Delete", async () => {
    const view = await render(<PinPad label="Enter PIN" onComplete={() => {}} />);

    const activeLabel = () => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? null;
    };

    byText(view.container, "button", "1").focus();
    expect(activeLabel()).toBe("1");

    await press("ArrowRight");
    expect(activeLabel()).toBe("2");

    await press("ArrowRight");
    expect(activeLabel()).toBe("3");

    await press("ArrowDown");
    expect(activeLabel()).toBe("6");

    await press("ArrowLeft");
    expect(activeLabel()).toBe("5");

    await press("ArrowLeft");
    expect(activeLabel()).toBe("4");

    await press("ArrowDown");
    expect(activeLabel()).toBe("7");

    // With no digits entered yet, Delete (slot 11) is disabled so ArrowDown from 7 or 9 lands on 0.
    await press("ArrowDown");
    expect(activeLabel()).toBe("0");

    await press("ArrowUp");
    expect(activeLabel()).toBe("8");

    await press("ArrowRight");
    expect(activeLabel()).toBe("9");

    await press("ArrowDown");
    expect(activeLabel()).toBe("0");

    // Once a digit is entered, Delete enables at slot 11 and participates in 3x4 directional navigation.
    await click(byText(view.container, "button", "5"));
    byText(view.container, "button", "9").focus();

    await press("ArrowDown");
    expect(activeLabel()).toBe("Delete");

    await press("ArrowLeft");
    expect(activeLabel()).toBe("0");

    await press("ArrowRight");
    expect(activeLabel()).toBe("Delete");

    await press("ArrowUp");
    expect(activeLabel()).toBe("9");

    // Erasing the final digit while focused on Delete moves focus cleanly onto 0 instead of leaving it on a disabled key.
    const delBtn = view.container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!;
    delBtn.focus();
    await click(delBtn);
    expect(activeLabel()).toBe("0");
    expect(delBtn.disabled).toBe(true);

    await view.unmount();
  });
});

describe("Scrubber multi-segment markers, hover labels and scrub drag lifecycle", () => {
  test("renders recap, intro and outro segments with data-kind, shows segment labels in .scrubber-tip on hover, and tracks onScrubChange across drag", async () => {
    const media = new FakeMedia(1200);
    const scrubStates: boolean[] = [];
    const seeks: number[] = [];

    const view = await render(
      <Scrubber
        media={media}
        segments={{
          recap: { start: 0, end: 60 },
          intro: { start: 120, end: 210 },
          outro: { start: 1080, end: 1200 },
        }}
        onSeek={(t) => seeks.push(t)}
        onScrubChange={(s) => scrubStates.push(s)}
      />,
    );

    const bar = view.container.querySelector<HTMLDivElement>(".scrubber")!;
    bar.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 400,
        right: 1100,
        bottom: 420,
        width: 1000,
        height: 20,
        x: 100,
        y: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    bar.setPointerCapture = () => {};

    const segments = [...view.container.querySelectorAll<HTMLElement>(".scrubber-segment")];
    expect(segments.map((el) => el.dataset.kind)).toEqual(["recap", "intro", "outro"]);
    expect(segments[0]!.style.left).toBe("0%");
    expect(segments[0]!.style.width).toBe("5%");
    expect(segments[1]!.classList.contains("scrubber-intro")).toBe(true);
    expect(segments[1]!.style.left).toBe("10%");
    expect(segments[1]!.style.width).toBe("7.5%");
    expect(segments[2]!.style.left).toBe("90%");
    expect(segments[2]!.style.width).toBe("10%");

    const tip = () => view.container.querySelector(".scrubber-tip")?.textContent?.trim();
    const pointer = (type: string, clientX: number) =>
      act(async () => {
        bar.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX }));
      });

    // Hovering inside recap (36s), intro (180s), plain timeline (600s) and outro (1140s).
    await pointer("pointermove", 130);
    expect(tip()).toBe("0:36 · Recap");

    await pointer("pointermove", 250);
    expect(tip()).toBe("3:00 · Intro");

    await pointer("pointermove", 600);
    expect(tip()).toBe("10:00");

    await pointer("pointermove", 1050);
    expect(tip()).toBe("19:00 · Credits");

    // Dragging fires onScrubChange(true) on press, holds seek during move, and commits onScrubChange(false) + onSeek on release.
    expect(scrubStates).toEqual([]);
    await pointer("pointerdown", 350);
    expect(bar.dataset.scrubbing).toBe("true");
    expect(scrubStates).toEqual([true]);
    expect(seeks).toEqual([]);

    await pointer("pointermove", 600);
    expect(scrubStates).toEqual([true]);
    expect(seeks).toEqual([]);

    await pointer("pointerup", 600);
    expect(bar.dataset.scrubbing).toBe("false");
    expect(scrubStates).toEqual([true, false]);
    expect(seeks).toEqual([600]);

    // A cancelled drag also clears scrubbing and notifies onScrubChange(false) without seeking.
    await pointer("pointerdown", 400);
    expect(scrubStates).toEqual([true, false, true]);
    await pointer("pointercancel", 400);
    expect(bar.dataset.scrubbing).toBe("false");
    expect(scrubStates).toEqual([true, false, true, false]);
    expect(seeks).toEqual([600]);

    await view.unmount();
  });
});

describe("usePageMotion desktop tab transitions and reduced-motion invariants", () => {
  test("desktop (phone = false) produces directional tab transitions that enter running state (go: true) and settle cleanly", async () => {
    document.documentElement.dataset.reduceMotion = "off";
    let latest: PageMotion | undefined;

    function Harness({ pages, enabled = true, phone = false }: { pages: Entry[]; enabled?: boolean; phone?: boolean }) {
      latest = usePageMotion(pages, enabled, phone);
      return (
        <div
          data-phase={latest ? (latest.go ? "run" : "prepare") : "idle"}
          data-dir={latest?.dir}
          data-tab={latest?.tab || undefined}
        />
      );
    }

    const home: Entry = { key: 1, route: { name: "home" } };
    const library: Entry = { key: 2, route: { name: "library" } };
    const discoverSeries: Entry = { key: 3, route: { name: "discover", type: "series" } };

    const view = await render(<Harness pages={[home]} phone={false} />);
    expect(latest).toBeUndefined();

    // Forward top-level tab switch (home -> library) on desktop.
    await view.rerender(<Harness pages={[library]} phone={false} />);
    expect(latest).toMatchObject({ enter: 2, leave: 1, dir: 1, tab: true, go: false });
    expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("prepare");

    // Two animation frames advance the pair into the active running state (go: true / phase: "run").
    await nextFrames(2);
    expect(latest).toMatchObject({ enter: 2, leave: 1, dir: 1, tab: true, go: true });
    expect(view.container.firstElementChild?.getAttribute("data-phase")).toBe("run");

    // Settling after the 210ms desktop tab budget clears motion back to idle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(latest).toBeUndefined();

    // Backward top-level tab switch (library -> discover:series) produces dir: -1.
    await view.rerender(<Harness pages={[discoverSeries]} phone={false} />);
    expect(latest).toMatchObject({ enter: 3, leave: 2, dir: -1, tab: true, go: false });
    await nextFrames(2);
    expect(latest).toMatchObject({ enter: 3, leave: 2, dir: -1, tab: true, go: true });

    await view.unmount();
  });

  test("instant swaps when disabled or skipped, and card-origin morphs stay strictly phone-only and respect reduced motion", async () => {
    let latest: PageMotion | undefined;
    function Harness({ pages, enabled = true, phone = false }: { pages: Entry[]; enabled?: boolean; phone?: boolean }) {
      latest = usePageMotion(pages, enabled, phone);
      return null;
    }

    const home: Entry = { key: 10, route: { name: "home" } };
    const library: Entry = { key: 11, route: { name: "library" } };
    const search: Entry = { key: 12, route: { name: "search" } };
    const detail: Entry = { key: 13, route: { name: "detail", type: "movie", id: "tt0000001" } };

    // Instant swap when transitions are disabled or skipNextPageMotion() is armed.
    const view = await render(<Harness pages={[home]} enabled={false} phone={false} />);
    await view.rerender(<Harness pages={[library]} enabled={false} phone={false} />);
    expect(latest).toBeUndefined();

    skipNextPageMotion();
    await view.rerender(<Harness pages={[search]} enabled phone={false} />);
    expect(latest).toBeUndefined();

    // Card tap origin is never recorded onto desktop push transitions, and reduced motion ("on") suppresses it on phone too.
    const stopWatching = watchCardTaps();
    const card = document.createElement("div");
    card.className = "card";
    card.getBoundingClientRect = () =>
      ({ left: 20, top: 40, right: 200, bottom: 310, width: 180, height: 270, x: 20, y: 40, toJSON: () => ({}) }) as DOMRect;
    document.body.append(card);

    try {
      document.documentElement.dataset.reduceMotion = "off";
      card.click();
      await view.rerender(<Harness pages={[search, detail]} enabled phone={false} />);
      expect(latest).toMatchObject({ enter: 13, leave: 12, dir: 1, card: undefined });

      const detailPhoneReduced: Entry = { key: 14, route: { name: "detail", type: "movie", id: "tt0000002" } };
      document.documentElement.dataset.reduceMotion = "on";
      card.click();
      await view.rerender(<Harness pages={[search, detailPhoneReduced]} enabled phone />);
      expect(latest?.card).toBeUndefined();
      expect(cardOrigin(14)).toBeUndefined();
    } finally {
      stopWatching();
      card.remove();
      await view.unmount();
    }
  });
});

describe("PauseScreen facts kicker and 160ms exit presence", () => {
  test("renders facts joined with remaining time and fades out over PAUSE_SCREEN_EXIT_MS", async () => {
    jest.useFakeTimers();
    const details: PauseDetails = {
      name: "Quiet Harbour",
      facts: "2024 · TV-14 · Drama",
      overview: "A calm evening at sea.",
      cast: [],
    };

    const view = await render(<PauseScreen allowed details={details} remaining="38m left" />);
    await act(async () => void jest.advanceTimersByTime(PAUSE_SCREEN_AFTER_MS + 10));

    expect(view.container.querySelector(".pause-screen-kicker")?.textContent).toBe("2024 · TV-14 · Drama · 38m left");

    await view.rerender(<PauseScreen allowed={false} details={details} remaining="38m left" />);
    const leavingEl = view.container.querySelector(".pause-screen");
    expect(leavingEl).not.toBeNull();
    expect(leavingEl?.getAttribute("data-leaving")).toBe("true");

    await act(async () => void jest.advanceTimersByTime(PAUSE_SCREEN_EXIT_MS + 10));
    expect(view.container.querySelector(".pause-screen")).toBeNull();

    await view.unmount();
  });
});
