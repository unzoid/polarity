/**
 * How the player crops the picture (#330): one setting shared by the player's button, its shortcut,
 * TV's controller binding and Settings → Advanced.
 *
 * - Fit: the whole picture, nothing cropped.
 * - Crop black bars: autocrop (docs/autocrop.md) takes off the bars that are part of the video.
 * - Fill window: the bars go first, then the picture covers the window with its edges cropped
 *   (mpv's `panscan`; the autocrop loop reads it).
 *
 * Where autocrop can't run (no mpv: the browser's video, YouTube) the button skips Crop black bars,
 * and Fill window fills without taking bars off first.
 */
export type CropMode = "fit" | "bars" | "fill";

export const CROP_MODES: readonly CropMode[] = ["fit", "bars", "fill"];

const LABELS: Record<CropMode, string> = { fit: "Fit", bars: "Crop black bars", fill: "Fill window" };

export const cropModeLabel = (mode: CropMode) => LABELS[mode];

export const isCropMode = (v: unknown): v is CropMode => CROP_MODES.includes(v as CropMode);

/** What the picture does in `mode`: Crop black bars without autocrop is Fit. */
export const shownCropMode = (mode: CropMode, canCrop: boolean): CropMode => (mode === "bars" && !canCrop ? "fit" : mode);

/** The mode a press moves on to, from what the picture does now: Fit, Crop black bars, Fill window, Fit… */
export function nextCropMode(mode: CropMode, canCrop: boolean): CropMode {
  const order = canCrop ? CROP_MODES : CROP_MODES.filter((m) => m !== "bars");
  const now = order.indexOf(shownCropMode(mode, canCrop));
  return order[(now + 1) % order.length];
}

/** Whether autocrop runs in `mode`. */
export const cropsBars = (mode: CropMode) => mode !== "fit";

/**
 * The mode for prefs stored before #330, which had an autocrop switch and a separate Fill: autocrop
 * on starts on Crop black bars, or on Fill window if Fill was on too; Fill alone is Fill window.
 */
export function earlierCropMode(stored: Record<string, unknown>): CropMode | undefined {
  if (isCropMode(stored.cropMode)) return stored.cropMode;
  const autocrop = stored.autocrop === true;
  const fill = stored.videoFill === true;
  return fill ? "fill" : autocrop ? "bars" : undefined;
}
