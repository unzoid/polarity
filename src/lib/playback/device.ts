import { useEffect, useState } from "react";
import { isDesktop, isIpad, isTvDevice, os } from "../platform/device";
import type { Device, DeviceForm } from "./bestMatch";

/**
 * What this device can show and decode, for Best Match (#230). The screen's HDR
 * from the `dynamic-range` media query (observed live for external HDMI/display
 * changes); hardware decoding of 10-bit 1080p and 4K HEVC/AV1 from the WebView's
 * Media Capabilities (a power-efficient decode is a hardware one, with 8-bit
 * fallback when a WebView rejects 10-bit strings). mpv uses the same GPU when
 * Settings → Advanced's hardware decoding is on, and shows Dolby Vision itself;
 * the built-in player only where the system says so. What can't be told stays
 * `null`, worth no points either way.
 */

type Caps = Pick<Device, "hdr" | "dolbyVision" | "hevc" | "av1" | "hevc4k" | "av14k">;
/** What the system said it decodes. */
type System = Omit<Caps, "hdr">;
type Engine = "mpv" | "html";

const CODECS = {
  hevc10: 'video/mp4; codecs="hvc1.2.4.L120.B0"',
  hevc8: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  hevc4k10: 'video/mp4; codecs="hvc1.2.4.L150.B0"',
  av110: 'video/mp4; codecs="av01.0.08M.10"',
  av18: 'video/mp4; codecs="av01.0.08M.08"',
  av14k10: 'video/mp4; codecs="av01.0.12M.10"',
  dolbyVision: 'video/mp4; codecs="dvh1.05.06"',
} as const;

interface ProbeSpec {
  contentType: string;
  width: number;
  height: number;
  bitrate: number;
}

/** Whether the system decodes this profile, in hardware; null when it can't say. */
async function decodes(spec: ProbeSpec): Promise<{ supported: boolean; hardware: boolean } | null> {
  const mc = (navigator as { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
  if (!mc?.decodingInfo) return null;
  try {
    const info = await mc.decodingInfo({
      type: "file",
      video: { ...spec, framerate: 24 },
    });
    return { supported: info.supported, hardware: info.supported && info.powerEfficient };
  } catch {
    return null;
  }
}

/** Probe preferred 10-bit codec first, falling back to 8-bit if the WebView doesn't recognize 10-bit strings. */
async function decodesPreferred(primary: ProbeSpec, fallback?: ProbeSpec) {
  const first = await decodes(primary);
  if (first && (first.supported || !fallback)) return first;
  return fallback ? await decodes(fallback) : first;
}

/** The display shows HDR right now (dynamic: changes when plugging in an external monitor/TV). */
function hdrScreen(): boolean | null {
  if (typeof matchMedia !== "function") return null;
  return matchMedia("(dynamic-range: high)").matches;
}

/** Viewing form factor (Netflix VMAF v1 viewing-distance curves: Phone@5H, TV@3H, Desktop@1.5H). */
export function detectDeviceForm(): DeviceForm {
  if (isTvDevice) return "tv";
  if (isDesktop) return "desktop";
  if (isIpad) return "tablet";
  if (os === "android" || os === "ios") {
    if (typeof window !== "undefined" && Math.min(window.screen.width, window.screen.height) >= 700) return "tablet";
    return "phone";
  }
  return "desktop";
}

let probed: Promise<System> | undefined;
const probe = () =>
  (probed ??= Promise.all([
    decodesPreferred(
      { contentType: CODECS.hevc10, width: 1920, height: 1080, bitrate: 8_000_000 },
      { contentType: CODECS.hevc8, width: 1920, height: 1080, bitrate: 8_000_000 },
    ),
    decodesPreferred(
      { contentType: CODECS.av110, width: 1920, height: 1080, bitrate: 8_000_000 },
      { contentType: CODECS.av18, width: 1920, height: 1080, bitrate: 8_000_000 },
    ),
    decodesPreferred({ contentType: CODECS.hevc4k10, width: 3840, height: 2160, bitrate: 20_000_000 }),
    decodesPreferred({ contentType: CODECS.av14k10, width: 3840, height: 2160, bitrate: 15_000_000 }),
    decodes({ contentType: CODECS.dolbyVision, width: 1920, height: 1080, bitrate: 8_000_000 }),
  ]).then(([hevc, av1, hevc4k, av14k, dv]) => ({
    hevc: hevc ? hevc.hardware : null,
    av1: av1 ? av1.hardware : null,
    hevc4k: hevc4k ? hevc4k.hardware : null,
    av14k: av14k ? av14k.hardware : null,
    dolbyVision: dv ? dv.supported : null,
  })));

/** The capabilities for an engine, from what the system said. */
export function deviceCaps(
  engine: Engine | null,
  hwdec: boolean,
  system: System,
  hdr: boolean | null,
): Caps {
  // mpv with hardware decoding off decodes everything in software.
  const hw = (v: boolean | null) => (engine === "mpv" && !hwdec ? false : v);
  const out: Caps = {
    hdr,
    dolbyVision: engine === "mpv" ? true : engine === "html" ? system.dolbyVision : null,
    hevc: hw(system.hevc),
    av1: hw(system.av1),
  };
  if (system.hevc4k !== undefined) out.hevc4k = hw(system.hevc4k);
  if (system.av14k !== undefined) out.av14k = hw(system.av14k);
  return out;
}

const UNKNOWN: System = { hevc: null, av1: null, hevc4k: null, av14k: null, dolbyVision: null };

/** This device's capabilities, once the system has answered (unknown until then). */
export function useDeviceCaps(engine: Engine | null, hwdec: boolean): Caps {
  const [system, setSystem] = useState(UNKNOWN);
  const [hdr, setHdr] = useState<boolean | null>(hdrScreen);
  useEffect(() => {
    let live = true;
    void probe().then((s) => live && setSystem(s));
    return () => void (live = false);
  }, []);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(dynamic-range: high)");
    setHdr(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setHdr(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return deviceCaps(engine, hwdec, system, hdr);
}
