import { formatRuntimeLong } from "./time";

/** Three hours across the whole track: a 52 minute episode fills under a third, a 2 h 17 film three quarters. */
export const RUN_SCALE_SECONDS = 3 * 60 * 60;

/**
 * Polarity's signature: a title's running time drawn to scale, with what you've watched inked on it. The same
 * scale everywhere (cards, episode rows, Continue Watching, the scrubber), so lengths compare at a glance, the
 * way a projectionist's running-time sheet reads. Hour marks sit on the track. Nothing is drawn without a length.
 */
export function RunLine({ length, watched = 0, className = "" }: { length: number; watched?: number; className?: string }) {
  if (!(length > 0)) return null;
  const lengthPct = Math.min(100, (length / RUN_SCALE_SECONDS) * 100);
  const watchedPct = Math.max(0, Math.min(100, (watched / length) * 100));
  const label = watched > 0 ? `${formatRuntimeLong(length)}, ${formatRuntimeLong(watched)} watched` : formatRuntimeLong(length);
  return (
    <div className={`run ${className}`} role="img" aria-label={label}>
      <span className="run-track" />
      <span className="run-hour" style={{ left: "33.333%" }} />
      <span className="run-hour" style={{ left: "66.666%" }} />
      <span className="run-length" style={{ width: `${lengthPct}%` }}>
        {watchedPct > 0 && <span className="run-watched" style={{ width: `${watchedPct}%` }} />}
      </span>
    </div>
  );
}
