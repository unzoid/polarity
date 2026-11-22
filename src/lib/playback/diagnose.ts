import type { Prefs } from "../settings/prefs";
import { isSplitBrainTls, type StartStep } from "./startLog";

/**
 * Deterministic playback failure classification and ordered self-healing fix plan
 * (Netflix "Diagnose & Fix Playback" pattern).
 *
 * Classifies errors from the redacted start-up log + player error string so Polarity
 * never wastes retries mutating decoder flags on a dead 403/404 link, and conversely
 * can recover from driver/HDR/audio-filter incompatibilities in one click.
 */

export type PlaybackIssueKind =
  | "permanentSource"
  | "splitBrainTls"
  | "audioFilter"
  | "hdrPipeline"
  | "hwdecDecode"
  | "networkTransient"
  | "unknown";

export interface PlaybackDiagnosis {
  kind: PlaybackIssueKind;
  /** Short plain-language summary shown on the failure screen. */
  summary: string;
  /** True when the same stream URL might succeed after changing player settings. */
  retrySameSource: boolean;
  /** True when blindly stepping through more sources won't fix an engine/driver crash. */
  engineLevel: boolean;
}

export type FixAction =
  | { id: "resetAudioFilters"; label: string; prefsPatch: Partial<Prefs> }
  | { id: "forceSdr"; label: string; prefsPatch: Partial<Prefs> }
  | { id: "disableHwdec"; label: string; prefsPatch: Partial<Prefs> }
  | { id: "nextSource"; label: string }
  | { id: "htmlFallback"; label: string };

const PERMANENT_SOURCE_RE =
  /\b(401|403|404|410|451|unauthorized|forbidden|not found|gone|expired|web page|html|placeholder|no playable link|invalid source)\b/i;
const AUDIO_FILTER_RE = /\b(lavfi|dynaudnorm|pan=stereo|audio-spdif|audio filter|equalizer|alimiter|af\b|ao\b|audiounit|wasapi)\b/i;
const HDR_PIPELINE_RE = /\b(hdr|colorspace|bt\.?2020|pq\b|hlg\b|tone-?mapping|d3d11.*hdr|swapchain|10-?bit)\b/i;
const HWDEC_DECODE_RE =
  /\b(hwdec|mediacodec|videotoolbox|d3d11va|dxva2|nvdec|vaapi|vdpau|couldn't decode|decoder|player exited|crashed|unsupported format|format not supported)\b/i;
const NETWORK_TRANSIENT_RE =
  /\b(timeout|timed out|unreachable|econnreset|econnrefused|ehostunreach|network error|connection reset|429|500|502|503|504|stopped sending)\b/i;

/** Classify a playback failure from the start log steps and player error text. */
export function classifyPlaybackError(steps: readonly StartStep[], error: string | null | undefined): PlaybackDiagnosis {
  const err = (error ?? "").trim();
  const failedSteps = steps.filter((s) => s.tone === "fail" || s.tone === "warn").map((s) => s.text);
  const combined = [err, ...failedSteps].join(" · ");

  if (isSplitBrainTls(steps, err)) {
    return {
      kind: "splitBrainTls",
      summary: "The link check passed, but the player's TLS certificate verification failed.",
      retrySameSource: false,
      engineLevel: false,
    };
  }

  // Check server-stage permanent HTTP/container errors first so we never mutate GPU settings for a dead link.
  const serverFail = steps.some((s) => s.stage === "server" && (s.tone === "fail" || s.tone === "warn") && PERMANENT_SOURCE_RE.test(s.text));
  if (serverFail || PERMANENT_SOURCE_RE.test(err)) {
    return {
      kind: "permanentSource",
      summary: "This source link is unavailable or expired.",
      retrySameSource: false,
      engineLevel: false,
    };
  }

  if (AUDIO_FILTER_RE.test(combined)) {
    return {
      kind: "audioFilter",
      summary: "Audio processing or passthrough failed on this device.",
      retrySameSource: true,
      engineLevel: true,
    };
  }

  if (HDR_PIPELINE_RE.test(combined)) {
    return {
      kind: "hdrPipeline",
      summary: "HDR output failed on this display driver.",
      retrySameSource: true,
      engineLevel: true,
    };
  }

  if (HWDEC_DECODE_RE.test(combined)) {
    return {
      kind: "hwdecDecode",
      summary: "Hardware video decoding failed on this file.",
      retrySameSource: true,
      engineLevel: true,
    };
  }

  if (NETWORK_TRANSIENT_RE.test(combined)) {
    return {
      kind: "networkTransient",
      summary: "The source's server timed out or dropped the connection.",
      retrySameSource: false,
      engineLevel: false,
    };
  }

  return {
    kind: "unknown",
    summary: err || "Playback couldn't start.",
    retrySameSource: true,
    engineLevel: false,
  };
}

export interface FixPlanContext {
  engine: string | null;
  hasNextSource: boolean;
  canHtmlFallback: boolean;
}

/**
 * Build an ordered, non-destructive sequence of recovery steps for a failed playback attempt.
 * Skips settings that are already in their safest state and skips decoder tweaks for dead links.
 */
export function buildFixPlan(
  diagnosis: PlaybackDiagnosis,
  prefs: Pick<Prefs, "dialogueBoost" | "volumeLeveling" | "drcProfile" | "passthrough" | "hdrOutput" | "hwdec" | "deband" | "frameRateMatch">,
  ctx: FixPlanContext,
): FixAction[] {
  const actions: FixAction[] = [];

  const audioResetNeeded =
    prefs.dialogueBoost || prefs.volumeLeveling || prefs.drcProfile === "lateNight" || prefs.passthrough;
  const sdrNeeded = prefs.hdrOutput !== "sdr";
  const hwdecNeeded = prefs.hwdec;

  const pushAudio = () => {
    if (ctx.engine === "mpv" && audioResetNeeded) {
      actions.push({
        id: "resetAudioFilters",
        label: "Turn off audio filters & passthrough",
        prefsPatch: { dialogueBoost: false, volumeLeveling: false, drcProfile: "livingRoom", passthrough: false },
      });
    }
  };
  const pushSdr = () => {
    if (ctx.engine === "mpv" && sdrNeeded) {
      actions.push({
        id: "forceSdr",
        label: "Tone-map HDR to SDR",
        prefsPatch: { hdrOutput: "sdr" },
      });
    }
  };
  const pushHwdec = () => {
    if (ctx.engine === "mpv" && hwdecNeeded) {
      actions.push({
        id: "disableHwdec",
        label: "Switch to software decoding",
        prefsPatch: { hwdec: false, deband: "off", frameRateMatch: "off" },
      });
    }
  };
  const pushNext = () => {
    if (ctx.hasNextSource) {
      actions.push({ id: "nextSource", label: "Try the next source" });
    }
  };
  const pushHtml = () => {
    if (ctx.engine === "mpv" && ctx.canHtmlFallback) {
      actions.push({ id: "htmlFallback", label: "Switch to built-in player" });
    }
  };

  switch (diagnosis.kind) {
    case "permanentSource":
    case "networkTransient":
      pushNext();
      break;
    case "splitBrainTls":
      pushHtml();
      pushNext();
      break;
    case "audioFilter":
      pushAudio();
      pushHtml();
      pushNext();
      break;
    case "hdrPipeline":
      pushSdr();
      pushHwdec();
      pushHtml();
      pushNext();
      break;
    case "hwdecDecode":
      pushHwdec();
      pushSdr();
      pushHtml();
      pushNext();
      break;
    case "unknown":
      pushAudio();
      pushSdr();
      pushHwdec();
      pushNext();
      pushHtml();
      break;
  }

  return actions;
}
