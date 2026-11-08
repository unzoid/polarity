import { expect, test } from "bun:test";
import { act } from "react";
import {
  applySubtitleStyleToMpv,
  DEFAULT_SUBTITLE_STYLE,
  dialogueLook,
  forgetAssOverride,
  SubtitlePreview,
  SubtitleSettings,
} from "../../src/components/player/SubtitleSettings";
import { MpvMedia, type MpvTrack } from "../../src/components/player/mpvMedia";
import type { SubtitleStyle } from "../../src/lib/types";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const HEADER = [
  "[Script Info]",
  "PlayResY: 720",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment",
  "Style: Main,Rounded Sans,48,&H00FFFFFF,0,2",
  "Style: Sign,Brush Script,40,&H00202020,0,8",
].join("\n");

/** An mpv playing one subtitle track of `codec`, recording every option set. */
function fakeMpv(codec: string, extradata: string | null = HEADER) {
  const set = new Map<string, unknown>();
  const calls: string[] = [];
  const mpv = Object.create(MpvMedia.prototype) as MpvMedia;
  mpv.tracks = [{ id: 1, type: "sub", codec, selected: true } as MpvTrack];
  mpv.set = async (name: string, value: unknown) => {
    calls.push(name);
    set.set(name, value);
  };
  mpv.command = async (...args: unknown[]) => {
    if (args[0] === "get_property" && args[1] === "sub-ass-extradata" && extradata !== null) return extradata;
    if (args[0] === "set") return set.set(String(args[1]), args[2]);
    throw new Error("unknown property");
  };
  return { mpv, set, calls };
}

const apply = async (mpv: MpvMedia, style: SubtitleStyle) => {
  applySubtitleStyleToMpv(mpv, style, 0);
  await settle();
};

test("with the defaults, a styled track keeps its own font and look (#347)", async () => {
  const { mpv, set } = fakeMpv("ass");
  await apply(mpv, DEFAULT_SUBTITLE_STYLE);
  expect(set.get("sub-ass-override")).toBe("scale");
  expect(set.get("sub-ass-style-overrides")).toBe("");
});

test("choosing Segoe UI forces it on a styled track's dialogue, not its signs (#347)", async () => {
  const { mpv, set } = fakeMpv("ass");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, font: "Segoe UI Semibold", fontFromSubtitles: false });
  expect(set.get("sub-ass-override")).toBe("scale");
  expect(set.get("sub-ass-style-overrides")).toBe("Main.Fontname=Segoe UI Semibold,Main.Bold=0");
});

test("changing size or colour with From the subtitles keeps the release's font (#347)", async () => {
  const { mpv, set } = fakeMpv("ass");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, size: 150 });
  expect(set.get("sub-scale")).toBe(1.5);
  expect(set.get("sub-ass-override")).toBe("scale");
  expect(set.get("sub-ass-style-overrides")).toBe("");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, size: 150, color: "#FFE45C" });
  expect(set.get("sub-ass-override")).toBe("scale");
  expect(set.get("sub-ass-style-overrides")).toBe("Main.PrimaryColour=&H005CE4FF");
});

test("the overrides are only sent again when they change: each change re-reads the stream", async () => {
  const { mpv, calls } = fakeMpv("ass");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, color: "#FFE45C" });
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, color: "#FFE45C" });
  expect(calls.filter((c) => c === "sub-ass-style-overrides").length).toBe(1);
  expect(calls.filter((c) => c === "sub-ass-override").length).toBe(1);
  // A restarted mpv is told again.
  forgetAssOverride(mpv);
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, color: "#FFE45C" });
  expect(calls.filter((c) => c === "sub-ass-style-overrides").length).toBe(2);
});

test("an mpv that can't show the header still forces a picked font, as before (#347)", async () => {
  const { mpv, set } = fakeMpv("ass", null);
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, font: "Georgia", fontFromSubtitles: false });
  expect(set.get("sub-ass-override")).toBe("force");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, color: "#FFE45C" });
  expect(set.get("sub-ass-override")).toBe("scale");
  expect(set.get("sub-ass-style-overrides")).toBe("Default.PrimaryColour=&H005CE4FF");
});

test("plain-text subtitles use the system font with From the subtitles, and a picked one otherwise", async () => {
  const { mpv, set } = fakeMpv("subrip");
  await apply(mpv, DEFAULT_SUBTITLE_STYLE);
  expect(set.get("sub-font")).toBe(DEFAULT_SUBTITLE_STYLE.font);
  expect(set.get("sub-ass-style-overrides")).toBe("");
  await apply(mpv, { ...DEFAULT_SUBTITLE_STYLE, font: "Georgia", fontFromSubtitles: false });
  expect(set.get("sub-font")).toBe("Georgia");
});

test("styles saved before the choice: the old default font keeps the release's font, a picked font stays forced (#347)", () => {
  const old = { size: 120, raise: 0, color: "#FFFFFF", opacity: 100, outline: "thin", outlineColor: "#000000", background: 0 } as const;
  expect(dialogueLook({ ...old, font: "Segoe UI Semibold" }).font).toBeUndefined();
  expect(dialogueLook({ ...old, font: "Helvetica Neue" }).font).toBeUndefined();
  expect(dialogueLook({ ...old }).font).toBeUndefined();
  expect(dialogueLook({ ...old, font: "Georgia" }).font).toBe("Georgia");
  // Picked again after the change, the platform face is forced like any other.
  expect(dialogueLook({ ...old, font: "Segoe UI Semibold", fontFromSubtitles: false }).font).toBe("Segoe UI Semibold");
});

test("the Font menu says From the subtitles by default, also for a style saved before the choice (#347)", async () => {
  const picked: Partial<SubtitleStyle>[] = [];
  const { font: _, fontFromSubtitles: __, ...old } = DEFAULT_SUBTITLE_STYLE;
  const { container, unmount, rerender } = await render(
    <SubtitleSettings style={{ ...old, font: "Segoe UI Semibold" }} onChange={(p) => picked.push(p)} canPosition />,
  );
  const menu = () => container.querySelector<HTMLSelectElement | HTMLElement>("[aria-label='Subtitle font']");
  expect(container.textContent).toContain("From the subtitles");
  expect(container.textContent).toContain("Styled subtitles keep their own font");
  await rerender(<SubtitleSettings style={{ ...old, font: "Georgia" }} onChange={(p) => picked.push(p)} canPosition />);
  expect(container.textContent).not.toContain("Styled subtitles keep their own font");
  expect(menu()).not.toBeNull();
  await unmount();
});

test("the preview shows the release's dialogue font with From the subtitles on a styled track (#347)", async () => {
  const { mpv } = fakeMpv("ass");
  const { container, unmount, rerender } = await render(<SubtitlePreview style={DEFAULT_SUBTITLE_STYLE} media={mpv} />);
  await settle();
  const font = () => container.querySelector<HTMLElement>(".sub-preview")!.style.getPropertyValue("--sub-font");
  expect(font()).toBe('"Rounded Sans"');
  await rerender(<SubtitlePreview style={{ ...DEFAULT_SUBTITLE_STYLE, font: "Georgia", fontFromSubtitles: false }} media={mpv} />);
  await settle();
  expect(font()).toBe('"Georgia"');
  await unmount();
});
