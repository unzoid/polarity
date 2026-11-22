import { describe, expect, test } from "bun:test";
import { buildFixPlan, classifyPlaybackError } from "../src/lib/playback/diagnose";
import type { StartStep } from "../src/lib/playback/startLog";

const BASE_PREFS = {
  dialogueBoost: true,
  volumeLeveling: true,
  drcProfile: "livingRoom" as const,
  passthrough: false,
  hdrOutput: "auto" as const,
  hwdec: true,
  deband: "auto" as const,
  frameRateMatch: "seamless" as const,
};

describe("classifyPlaybackError & buildFixPlan", () => {
  test("classifies permanent HTTP 403/404/HTML errors and skips decoder mutations", () => {
    const steps: StartStep[] = [
      { at: 100, text: "Contacting cdn.example.com", tone: "info", stage: "server" },
      { at: 320, text: "403 Forbidden from cdn.example.com · 220 ms", tone: "warn", stage: "server" },
    ];
    const diag = classifyPlaybackError(steps, "The source link expired.");
    expect(diag.kind).toBe("permanentSource");
    expect(diag.retrySameSource).toBe(false);

    const plan = buildFixPlan(diag, BASE_PREFS, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(plan.map((a) => a.id)).toEqual(["nextSource"]);
  });

  test("classifies split-brain TLS and prefers HTML fallback then next source", () => {
    const steps: StartStep[] = [
      { at: 100, text: "200 OK from media.example.com · video/x-matroska · 120 ms", tone: "ok", stage: "server" },
      { at: 400, text: "mpv: TLS certificate verify failed", tone: "fail", stage: "player" },
    ];
    const diag = classifyPlaybackError(steps, "TLS handshake failed");
    expect(diag.kind).toBe("splitBrainTls");

    const plan = buildFixPlan(diag, BASE_PREFS, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(plan.map((a) => a.id)).toEqual(["htmlFallback", "nextSource"]);
  });

  test("classifies audio filter errors and resets filters first", () => {
    const steps: StartStep[] = [{ at: 200, text: "lavfi dynaudnorm filter failed", tone: "fail", stage: "player" }];
    const diag = classifyPlaybackError(steps, "audio filter error");
    expect(diag.kind).toBe("audioFilter");

    const plan = buildFixPlan(diag, BASE_PREFS, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(plan[0]?.id).toBe("resetAudioFilters");
  });

  test("classifies HDR pipeline errors and skips forceSdr when already SDR", () => {
    const steps: StartStep[] = [{ at: 200, text: "HDR swapchain colorspace failed", tone: "fail", stage: "player" }];
    const diag = classifyPlaybackError(steps, "d3d11 HDR failure");
    expect(diag.kind).toBe("hdrPipeline");

    const planAuto = buildFixPlan(diag, BASE_PREFS, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(planAuto.map((a) => a.id)).toEqual(["forceSdr", "disableHwdec", "htmlFallback", "nextSource"]);

    const planAlreadySdr = buildFixPlan(
      diag,
      { ...BASE_PREFS, hdrOutput: "sdr" },
      { engine: "mpv", hasNextSource: true, canHtmlFallback: true },
    );
    expect(planAlreadySdr.map((a) => a.id)).toEqual(["disableHwdec", "htmlFallback", "nextSource"]);
  });

  test("classifies hwdec decode errors and skips disableHwdec when already software", () => {
    const steps: StartStep[] = [{ at: 250, text: "MediaCodec decoder crashed", tone: "fail", stage: "player" }];
    const diag = classifyPlaybackError(steps, "hwdec failed");
    expect(diag.kind).toBe("hwdecDecode");

    const planOn = buildFixPlan(diag, BASE_PREFS, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(planOn[0]?.id).toBe("disableHwdec");

    const planOff = buildFixPlan(
      diag,
      { ...BASE_PREFS, hwdec: false },
      { engine: "mpv", hasNextSource: true, canHtmlFallback: true },
    );
    expect(planOff[0]?.id).toBe("forceSdr");
  });

  test("unknown error builds complete safe fallback ladder skipping disabled flags", () => {
    const diag = classifyPlaybackError([], "This file couldn't be played.");
    expect(diag.kind).toBe("unknown");

    const minimalPrefs = {
      dialogueBoost: false,
      volumeLeveling: false,
      drcProfile: "pure" as const,
      passthrough: false,
      hdrOutput: "sdr" as const,
      hwdec: false,
      deband: "off" as const,
      frameRateMatch: "off" as const,
    };
    const plan = buildFixPlan(diag, minimalPrefs, { engine: "mpv", hasNextSource: true, canHtmlFallback: true });
    expect(plan.map((a) => a.id)).toEqual(["nextSource", "htmlFallback"]);
  });
});
