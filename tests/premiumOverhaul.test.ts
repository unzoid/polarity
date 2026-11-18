import { beforeEach, describe, expect, test } from "bun:test";
import "./storageStub";
import { NEUTRAL, scoreOne, scoreSources, type Device, type MatchContext } from "../src/lib/playback/bestMatch";
import { PAUSE_SCREEN_AFTER_MS, PAUSE_SCREEN_EXIT_MS, pauseDetails } from "../src/lib/playback/pauseScreen";
import { savedDownload, savedSource, sourceKey } from "../src/lib/playback/savedSource";
import {
  autoPickOrder,
  compareBy,
  defaultFilter,
  featuredMatchSummary,
  forgetPlayerSourceChoices,
  sourceBadges,
  sourceRow,
  tagsOf,
} from "../src/lib/playback/sources";
import type { Meta, RankedStream, Settings, Stream, StreamQuality } from "../src/lib/types";

const GB = 1e9;

function streamFixture(
  label: string,
  quality: Partial<StreamQuality> = {},
  addon = "Open Films",
  extra: Partial<RankedStream> = {},
): RankedStream {
  return {
    addon,
    label,
    stream: {
      url: `https://media.example.com/${encodeURIComponent(label)}.mkv`,
      title: label,
    },
    quality: {
      resolution: 2160,
      hdr: false,
      dolbyVision: false,
      lowQualitySource: false,
      direct: true,
      languages: [],
      tags: [],
      ...quality,
    },
    ...extra,
  };
}

const makeDevice = (patch: Partial<Device> = {}): Device => ({
  screen: 2160,
  preferScreen: true,
  hdr: true,
  dolbyVision: true,
  hevc: true,
  av1: true,
  ...patch,
});

const makeContext = (patch: Partial<MatchContext> = {}): MatchContext => ({
  ...NEUTRAL,
  device: makeDevice(),
  runtimeSec: 7200,
  now: 1_700_000_000_000,
  ...patch,
});

beforeEach(() => {
  forgetPlayerSourceChoices();
});

describe("pauseScreen exit timing and facts formatting", () => {
  test("PAUSE_SCREEN_EXIT_MS is a crisp 160ms fade-out budget shorter than entrance delay", () => {
    expect(PAUSE_SCREEN_EXIT_MS).toBe(160);
    expect(PAUSE_SCREEN_EXIT_MS).toBeGreaterThan(0);
    expect(PAUSE_SCREEN_EXIT_MS).toBeLessThan(PAUSE_SCREEN_AFTER_MS);
  });

  test("pauseDetails formats facts from episode release year, certification and primary genres", () => {
    const series: Meta = {
      id: "tt0000001",
      type: "series",
      name: "Quiet Harbour",
      releaseInfo: "2021–2025",
      certification: " TV-14 ",
      genres: ["Drama", "Mystery", "Thriller"],
      videos: [
        {
          id: "tt0000001:2:4",
          title: "Low Tide",
          season: 2,
          episode: 4,
          released: "2024-11-03T00:00:00.000Z",
          overview: "Lanterns along the quay.",
        },
        {
          id: "tt0000001:2:5",
          title: "Fog Bell",
          season: 2,
          episode: 5,
        },
      ],
    };

    const withReleased = pauseDetails(series, "tt0000001:2:4");
    expect(withReleased?.facts).toBe("2024 · TV-14 · Drama, Mystery");

    const fallbackToSeriesYear = pauseDetails(series, "tt0000001:2:5");
    expect(fallbackToSeriesYear?.facts).toBe("2021–2025 · TV-14 · Drama, Mystery");
  });

  test("pauseDetails omits missing fact segments and leaves facts undefined when none exist", () => {
    const movie: Meta = {
      id: "tt0000002",
      type: "movie",
      name: "Glass Coast",
      releaseInfo: " 2023 ",
      genres: ["Adventure"],
      videos: [],
    };
    expect(pauseDetails(movie, "tt0000002")?.facts).toBe("2023 · Adventure");

    const certOnly: Meta = {
      id: "tt0000003",
      type: "movie",
      name: "Paper Compass",
      certification: "PG",
      genres: [""],
      videos: [],
    };
    expect(pauseDetails(certOnly, "tt0000003")?.facts).toBe("PG");

    const bare: Meta = {
      id: "tt0000004",
      type: "movie",
      name: "Silent Pier",
      releaseInfo: "   ",
      certification: " ",
      genres: [],
      videos: [],
    };
    expect(pauseDetails(bare, "tt0000004")?.facts).toBeUndefined();
  });
});

describe("sources badge parsing, ranking and match summaries", () => {
  test("tagsOf normalizes raw range, audio, codec and edition tokens without duplicates", () => {
    const s = streamFixture("2160p", {
      dolbyVision: true,
      hdr: true,
      codec: "x265",
      tags: ["DoVi", "HDR10plus", "TrueHD", "Atmos", "DTSX", "7.1", "10bit", "Remux", "IMAX", "3D"],
    });
    const tags = tagsOf(s);
    expect(tags).toContain("dv");
    expect(tags).toContain("hdr10+");
    expect(tags).toContain("hdr");
    expect(tags).toContain("truehd");
    expect(tags).toContain("atmos");
    expect(tags).toContain("dts:x");
    expect(tags).toContain("7.1");
    expect(tags).toContain("hevc");
    expect(tags).toContain("10-bit");
    expect(tags).toContain("remux");
    expect(tags).toContain("imax");
    expect(tags).toContain("3d");
    expect(new Set(tags).size).toBe(tags.length);

    expect(tagsOf(streamFixture("1080p", { codec: "AVC", tags: ["DTSHD", "5.1"] }))).toEqual(
      expect.arrayContaining(["h.264", "dts-hd", "5.1"]),
    );
  });

  test("sourceBadges derives micro-badges from quality while omitting tokens already in the row title", () => {
    const minimalLabel = streamFixture("2160p · 48.0 GB", {
      dolbyVision: true,
      hdr: true,
      codec: "HEVC",
      sizeBytes: 48 * GB,
      tags: ["Atmos", "TrueHD", "7.1", "Remux", "10-bit", "IMAX"],
    });
    expect(sourceRow(minimalLabel).title).toBe("2160p");
    // Hybrid DV + HDR10 shows DV without a redundant plain HDR pill.
    expect(sourceBadges(minimalLabel)).toEqual([
      { key: "dv", label: "DV", kind: "range" },
      { key: "atmos", label: "Atmos", kind: "audio" },
      { key: "truehd", label: "TrueHD", kind: "audio" },
      { key: "7.1", label: "7.1", kind: "audio" },
      { key: "hevc", label: "HEVC", kind: "codec" },
      { key: "remux", label: "Remux", kind: "edition" },
      { key: "imax", label: "IMAX", kind: "edition" },
      { key: "10-bit", label: "10-bit", kind: "edition" },
    ]);

    // Tokens already named in sourceRow(r).title ("Dolby Vision", "HEVC") are not repeated as badges.
    const descriptiveLabel = streamFixture("4K · Dolby Vision · HEVC · 48.0 GB", {
      dolbyVision: true,
      hdr: true,
      codec: "HEVC",
      sizeBytes: 48 * GB,
      tags: ["Atmos", "Remux"],
    });
    expect(sourceBadges(descriptiveLabel)).toEqual([
      { key: "atmos", label: "Atmos", kind: "audio" },
      { key: "remux", label: "Remux", kind: "edition" },
    ]);

    // HDR10+ already in title neither repeats HDR10+ nor falls through to a duplicate HDR badge.
    const hdr10PlusTitled = streamFixture("4K · HDR10+ · AV1 · 18.0 GB", {
      hdr: true,
      codec: "AV1",
      sizeBytes: 18 * GB,
      tags: ["HDR10+", "5.1"],
    });
    expect(sourceBadges(hdr10PlusTitled)).toEqual([{ key: "5.1", label: "5.1", kind: "audio" }]);

    // Plain HDR10 stream with minimal label gets the HDR range badge.
    const hdrOnly = streamFixture("2160p", { hdr: true, codec: "AV1", tags: ["DTS-HD", "5.1"] });
    expect(sourceBadges(hdrOnly)).toEqual([
      { key: "hdr", label: "HDR", kind: "range" },
      { key: "dts-hd", label: "DTS-HD", kind: "audio" },
      { key: "5.1", label: "5.1", kind: "audio" },
      { key: "av1", label: "AV1", kind: "codec" },
    ]);
  });

  test("featuredMatchSummary condenses top positive scoring reasons and drops unknown/negative ones", () => {
    const candidate = streamFixture("Quiet.Harbour.2025.2160p.WEB-DL.DV.HEVC", {
      resolution: 2160,
      dolbyVision: true,
      hdr: true,
      codec: "HEVC",
      languages: ["en"],
      sizeBytes: 18 * GB,
    });
    const match = scoreOne(
      candidate,
      makeContext({
        ownLanguage: { code: "en", from: "title" },
      }),
    );
    expect(featuredMatchSummary(match)).toBe("Fits this display · Direct stream · Original audio");

    const unknownOnly = scoreOne(
      streamFixture("Mystery.Stream", { resolution: undefined, direct: false }),
      makeContext({ device: makeDevice({ preferScreen: false }) }),
    );
    expect(featuredMatchSummary(unknownOnly)).toBeNull();
    expect(featuredMatchSummary(undefined)).toBeNull();
  });

  test("autoPickOrder and compareBy rank playable matches first and exclude CAM and wrong-episode streams", () => {
    const cam = streamFixture("Quiet.Harbour.2025.2160p.HDCAM-NOTREAL", {
      resolution: 2160,
      lowQualitySource: true,
      sizeBytes: 8 * GB,
    });
    const wrongEp = streamFixture(
      "Quiet.Harbour.S01E02.2160p.WEB-DL.DV-NOTREAL",
      { resolution: 2160, dolbyVision: true, hdr: true, sizeBytes: 14 * GB },
      "Open Films",
      { otherEpisode: true, fileEpisode: "S01E02" },
    );
    const uhdDv = streamFixture("Quiet.Harbour.S01E01.2160p.WEB-DL.DV.HEVC-MADEUP", {
      resolution: 2160,
      dolbyVision: true,
      hdr: true,
      codec: "HEVC",
      sizeBytes: 12 * GB,
    });
    const fhd = streamFixture("Quiet.Harbour.S01E01.1080p.WEB-DL.H264-MADEUP", {
      resolution: 1080,
      codec: "H.264",
      sizeBytes: 4 * GB,
    });
    const unsized = streamFixture("Quiet.Harbour.S01E01.720p.WEB-MADEUP", {
      resolution: 720,
      sizeBytes: undefined,
    });

    const settings = { sourceAutoTags: ["dv", "imax"], audioLanguage: "en" } as unknown as Settings;
    // Only tags available on at least one stream narrow defaultFilter ("dv" kept, absent "imax" dropped).
    expect(defaultFilter([uhdDv, fhd], settings).tags).toEqual(["dv"]);

    const ordered = autoPickOrder([cam, wrongEp, fhd, uhdDv], settings, undefined, makeContext());
    expect(ordered.map((r) => r.label)).toEqual([uhdDv.label]);

    // sizeAsc places smallest known files first and unknown-size files last.
    const pool = [unsized, uhdDv, fhd];
    const scores = scoreSources(pool, makeContext());
    expect([...pool].sort(compareBy("sizeAsc", scores)).map((r) => r.label)).toEqual([
      fhd.label,
      uhdDv.label,
      unsized.label,
    ]);
    expect([...pool].sort(compareBy("quality", scores)).map((r) => r.label)).toEqual([
      uhdDv.label,
      fhd.label,
      unsized.label,
    ]);
  });
});

describe("savedSource and savedDownload matching invariants", () => {
  const target = { metaId: "tt0000001", videoId: "tt0000001:1:3" };
  const webStream: Stream = { url: "https://media.example.com/harbour-s01e03.mkv" };
  const altStream: Stream = { url: "https://media.example.com/harbour-s01e03-720p.mkv" };

  test("sourceKey normalizes web URLs, case-insensitive torrent hashes with default fileIdx, and ytId", () => {
    expect(sourceKey(webStream)).toBe("https://media.example.com/harbour-s01e03.mkv");
    expect(sourceKey({ infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" })).toBe(
      "abcdef0123456789abcdef0123456789abcdef01#0",
    );
    expect(sourceKey({ infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01", fileIdx: 4 })).toBe(
      "abcdef0123456789abcdef0123456789abcdef01#4",
    );
    expect(sourceKey({ ytId: "aaaaaaaaaaa" })).toBe("aaaaaaaaaaa");
    expect(sourceKey({})).toBe("");
  });

  test("savedSource matches only the exact metaId + videoId while still offered in the current answer", () => {
    const freshWeb = streamFixture("1080p", {}, "Open Films", {
      stream: { ...webStream, title: "Freshly Ranked" },
    });
    const freshAlt = streamFixture("720p", { resolution: 720 }, "Open Films", { stream: altStream });

    expect(savedSource({ ...target, stream: webStream }, target, [freshAlt, freshWeb])).toBe(freshWeb);
    expect(savedSource({ ...target, stream: webStream }, target, [freshAlt])).toBeUndefined();
    expect(savedSource({ metaId: "tt0000009", videoId: target.videoId, stream: webStream }, target, [freshWeb])).toBeUndefined();
    expect(savedSource({ metaId: target.metaId, videoId: "tt0000001:1:4", stream: webStream }, target, [freshWeb])).toBeUndefined();

    const hashUpper: Stream = { infoHash: "B".repeat(40) };
    const hashLowerOffered = streamFixture("1080p", {}, "Open Films", {
      stream: { infoHash: "b".repeat(40), fileIdx: 0 },
    });
    expect(savedSource({ ...target, stream: hashUpper }, target, [hashLowerOffered])).toBe(hashLowerOffered);
  });

  test("savedDownload resumes a finished local download only when metaId, videoId and sourceKey match", () => {
    const localDownload: Stream = { url: "https://media.example.com/downloads/tt0000001-1-3.mkv" };
    expect(savedDownload({ ...target, stream: localDownload }, target, localDownload)).toBe(localDownload);
    expect(savedDownload({ ...target, stream: webStream }, target, localDownload)).toBeUndefined();
    expect(
      savedDownload({ metaId: "tt0000002", videoId: target.videoId, stream: localDownload }, target, localDownload),
    ).toBeUndefined();
  });
});
