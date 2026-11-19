import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

/** Half the track's height (player.css `.speed-line`): the knob's centre is this far in from either end. */
const INSET = 16;

/**
 * Playback speed as a stepped pill: a thick track with a dot at each speed and its label above it, filled from the
 * left in the accent up to the chosen speed, where a white knob sits inside the fill's end. Click or drag along it
 * (it snaps to the nearest stop), or use the arrow keys, Home and End.
 */
export function SpeedLine({ speeds, value, onChange, label }: { speeds: number[]; value: number; onChange: (v: number) => void; label: (v: number) => string }) {
  const line = useRef<HTMLDivElement>(null);
  const at = Math.max(0, speeds.indexOf(value));
  const last = speeds.length - 1;
  const place = (i: number) => (last ? i / last : 0);
  /** A stop's place along the track: the ends are a knob's radius in from its edges. */
  const left = (i: number) => `calc(${INSET}px + (100% - ${INSET * 2}px) * ${place(i)})`;

  const pick = (clientX: number) => {
    const r = line.current?.getBoundingClientRect();
    if (!r || r.width <= INSET * 2) return;
    const i = Math.round(Math.max(0, Math.min(1, (clientX - r.left - INSET) / (r.width - INSET * 2))) * last);
    if (speeds[i] !== value) onChange(speeds[i]);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.drag = "";
    pick(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    delete e.currentTarget.dataset.drag;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? at - 1
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? at + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, Math.min(last, to));
    if (i !== at) onChange(speeds[i]);
  };

  return (
    <div className="speed-line-wrap" style={{ "--speed-inset": `${INSET}px` } as CSSProperties}>
      <div className="speed-line-labels" aria-hidden>
        {speeds.map((s, i) => (
          <button key={s} tabIndex={-1} data-on={i === at || undefined} style={{ left: left(i) }} onClick={() => s !== value && onChange(s)}>
            {s}x
          </button>
        ))}
      </div>
      <div
        ref={line}
        className="speed-line"
        role="slider"
        tabIndex={0}
        aria-label="Playback speed"
        aria-valuemin={speeds[0]}
        aria-valuemax={speeds[last]}
        aria-valuenow={value}
        aria-valuetext={label(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {speeds.map((s, i) => (
          <i key={s} className="speed-line-stop" style={{ left: left(i) }} />
        ))}
        {/* The fill reaches past the chosen stop by a knob's radius, so the knob sits inside its rounded end. */}
        <span className="speed-line-fill" style={{ width: `calc(${INSET * 2}px + (100% - ${INSET * 2}px) * ${place(at)})` }} aria-hidden />
        {/* A layer as wide as the stops' run, moved by a share of its own width: the knob rides its left edge. */}
        <span className="speed-line-rider" style={{ transform: `translateX(${place(at) * 100}%)` }} aria-hidden>
          <span className="speed-line-knob" />
        </span>
      </div>
    </div>
  );
}
