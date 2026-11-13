import { expect, test } from "bun:test";
import { audioFormatLabel, hdrLabel, playingFormat, resolutionLabel } from "../src/lib/playback/playingFormat";

test("the picture's size names its resolution, a wide film's by its width", () => {
  expect(resolutionLabel(3840, 2160)).toBe("4K");
  expect(resolutionLabel(3840, 1600)).toBe("4K");
  expect(resolutionLabel(1920, 800)).toBe("1080p");
  expect(resolutionLabel(1280, 720)).toBe("720p");
  expect(resolutionLabel(720, 480)).toBe("480p");
  expect(resolutionLabel(undefined, undefined)).toBeUndefined();
});

test("HDR comes from the picture itself: Dolby Vision over its PQ base, HDR10, HLG, nothing for SDR", () => {
  expect(hdrLabel("pq", 8)).toBe("Dolby Vision");
  expect(hdrLabel("pq")).toBe("HDR10");
  expect(hdrLabel("hlg")).toBe("HLG");
  expect(hdrLabel("bt.1886")).toBeUndefined();
});

test("the sound's format by FFmpeg's codec and profile", () => {
  expect(audioFormatLabel("truehd", "Dolby TrueHD + Dolby Atmos")).toBe("Dolby Atmos");
  expect(audioFormatLabel("eac3", "Dolby Digital Plus + Dolby Atmos")).toBe("Dolby Atmos");
  expect(audioFormatLabel("dts", "DTS-HD MA + DTS:X")).toBe("DTS:X");
  expect(audioFormatLabel("dts", "DTS-HD MA")).toBe("DTS-HD MA");
  expect(audioFormatLabel("dts")).toBe("DTS");
  expect(audioFormatLabel("eac3")).toBe("Dolby Digital Plus");
  // Everyday codecs say nothing worth a badge.
  expect(audioFormatLabel("aac", "LC")).toBeUndefined();
});

test("one line, only what's known", () => {
  expect(
    playingFormat({
      width: 3840,
      height: 2160,
      gamma: "pq",
      dolbyVision: 8,
      audio: { codec: "eac3", profile: "Dolby Digital Plus + Dolby Atmos", channels: 6, lang: "eng" },
    }),
  ).toBe("4K · Dolby Vision · Dolby Atmos · English 5.1");
  expect(playingFormat({ width: 1920, height: 1080, audio: { codec: "aac", channels: 2 } })).toBe("1080p · 2.0");
  expect(playingFormat({})).toBeUndefined();
});
