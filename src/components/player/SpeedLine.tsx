import { useRef, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Playback speed as Netflix has it on the desktop: one line with a stop for each speed and its label under it,
 * the chosen one a ringed knob that slides there. Click or drag along it (it snaps to the nearest stop), or use
 * the arrow keys, Home and End.
 */
export function SpeedLine({ speeds, value, onChange, label }: { speeds: number[]; value: number; onChange: (v: number) => void; label: (v: number) => string }) {
  const line = useRef<HTMLDivElement>(null);
  const at = Math.max(0, speeds.indexOf(value));
  const last = speeds.length - 1;
  const place = (i: number) => (last ? i / last : 0);

  const pick = (clientX: number) => {
    const r = line.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const i = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * last);
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
    <div className="speed-line-wrap">
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
          <i key={s} className="speed-line-stop" style={{ left: `${place(i) * 100}%` }} />
        ))}
        {/* A layer as wide as the line, moved by a share of its own width: the knob rides its left edge. */}
        <span className="speed-line-rider" style={{ transform: `translateX(${place(at) * 100}%)` }} aria-hidden>
          <span className="speed-line-knob" />
        </span>
      </div>
      <div className="speed-line-labels" aria-hidden>
        {speeds.map((s, i) => (
          <button key={s} tabIndex={-1} data-on={i === at || undefined} style={{ left: `${place(i) * 100}%` }} onClick={() => s !== value && onChange(s)}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
