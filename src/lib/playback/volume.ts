/**
 * The volume slider's position (0–1, what the player shows and stores) as loudness (test report
 * 1, item 13). Equal steps should sound like equal steps: loudness goes roughly as sound pressure
 * to the power 0.6 (Stevens), so the amplitude for a position is position^(1/0.6). Half way is
 * about −10 dB, a quarter about −20 dB. Both players take that amplitude: a <video>'s `volume` is
 * amplitude as it is; mpv cubes its `volume` (mpvVolume undoes that).
 */
const LOUDNESS_EXPONENT = 0.6;

/**
 * The amplitude for a slider position: 0–1 up to 100%, more past it. Positions past 100% follow
 * the same curve (200% sounds about twice as loud as 100%, +10 dB), and only mpv can play them:
 * `limit` is the furthest position the player may go (1 for a <video>, whose volume stops at 1).
 */
export function sliderAmplitude(position: number, limit = 1): number {
  if (!(position > 0)) return 0;
  return Math.min(limit, position) ** (1 / LOUDNESS_EXPONENT);
}

/** The loudest slider positions Settings → Subtitles & Audio offers: 100%, 150% or 200%. */
export const MAX_VOLUMES = [1, 1.5, 2] as const;

/** mpv's `volume` for an amplitude (100 at amplitude 1): mpv's own gain is (volume / 100)³. Its launch allows up to 200. */
export function mpvVolume(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  return Math.min(200, Math.round(Math.cbrt(amplitude) * 1000) / 10);
}
