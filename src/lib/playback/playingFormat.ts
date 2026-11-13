import { languageName } from "./languages";

/** What the player knows of the picture and sound playing now. */
export interface PlayingFormatInput {
  /** The decoded picture's size. */
  width?: number;
  height?: number;
  /** mpv's `video-params/gamma`: "pq" for HDR10 and Dolby Vision, "hlg" for HLG. */
  gamma?: string;
  /** The video track's Dolby Vision profile, when it has one. */
  dolbyVision?: number;
  audio?: {
    codec?: string;
    /** FFmpeg's profile name: "Dolby TrueHD + Dolby Atmos", "DTS-HD MA + DTS:X"… */
    profile?: string;
    channels?: number;
    lang?: string;
  };
}

/** "4K", "1080p": by width as well, so a 1920×800 film is still 1080p. */
export function resolutionLabel(width?: number, height?: number): string | undefined {
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 && h <= 0) return undefined;
  if (w >= 3200 || h >= 2000) return "4K";
  if (w >= 2300 || h >= 1400) return "1440p";
  if (w >= 1700 || h >= 1000) return "1080p";
  if (w >= 1100 || h >= 700) return "720p";
  return h > 0 ? `${h}p` : undefined;
}

/** "Dolby Vision", "HDR10", "HLG", or nothing for SDR. */
export function hdrLabel(gamma?: string, dolbyVision?: number): string | undefined {
  if (dolbyVision != null && dolbyVision > 0) return "Dolby Vision";
  if (gamma === "pq") return "HDR10";
  if (gamma === "hlg") return "HLG";
  return undefined;
}

/** The sound's format when it's one people look for: Atmos, DTS:X, TrueHD, DTS-HD MA, Dolby Digital (Plus), DTS. */
export function audioFormatLabel(codec?: string, profile?: string): string | undefined {
  const p = profile?.toLowerCase() ?? "";
  if (p.includes("atmos")) return "Dolby Atmos";
  if (p.includes("dts:x")) return "DTS:X";
  switch (codec?.toLowerCase()) {
    case "truehd":
      return "TrueHD";
    case "eac3":
      return "Dolby Digital Plus";
    case "ac3":
      return "Dolby Digital";
    case "dts":
      return p.includes("ma") ? "DTS-HD MA" : p.includes("hd") ? "DTS-HD" : "DTS";
    default:
      return undefined;
  }
}

const layout = (channels?: number) =>
  channels === 8 ? "7.1" : channels === 6 ? "5.1" : channels === 2 ? "2.0" : channels === 1 ? "Mono" : channels ? `${channels} ch` : undefined;

/**
 * One line of what's playing, as it plays (not what the source said it would be): "4K · Dolby Vision ·
 * Dolby Atmos · English 5.1". Undefined until something is known.
 */
export function playingFormat(input: PlayingFormatInput): string | undefined {
  const a = input.audio;
  const sound = a && [languageName(a.lang ?? "") ?? undefined, layout(a.channels)].filter(Boolean).join(" ");
  const parts = [
    resolutionLabel(input.width, input.height),
    hdrLabel(input.gamma, input.dolbyVision),
    a && audioFormatLabel(a.codec, a.profile),
    sound || undefined,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : undefined;
}
