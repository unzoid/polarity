import type { ReactNode } from "react";

type IconProps = { size?: number; stroke?: number; className?: string };

const svg = (size: number, className: string | undefined, children: ReactNode, stroke = 1.7, viewBox = "0 0 24 24") => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
    focusable={false}
  >
    {children}
  </svg>
);

/** Crisp thin X: player close (top-left) and sheet close (top-right). */
export function IconPlayerClose({ size = 24, stroke = 1.75, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </>,
    stroke,
  );
}

/** Speedometer dial with needle: bottom bar Speed (1x). */
export function IconSpeed({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4.5 16.5a8.5 8.5 0 1 1 15 0" />
      <path d="M12 13l4.2-4.2" />
      <circle cx="12" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M6.8 11.2h1.2M16 11.2h1.2M12 6.8v1.2" strokeWidth={stroke * 0.85} />
    </>,
    stroke,
  );
}

/** Stacked overlapping cards: bottom bar Episodes. */
export function IconEpisodes({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="3" y="9" width="13.5" height="10" rx="1.6" />
      <path d="M6.2 6.2h11.5A1.6 1.6 0 0 1 19.3 7.8V16" />
      <path d="M9.4 3.5h10A1.6 1.6 0 0 1 21 5.1v7.8" />
    </>,
    stroke,
  );
}

/** Speech bubble box with subtitle lines: bottom bar Audio & Subtitles. */
export function IconAudioSubs({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 18h-4.5L12 21l-3.5-3H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M6.8 10.5h3.4M12.6 10.5h4.6M6.8 14h6.2M15.2 14h2" />
    </>,
    stroke,
  );
}

/** Stacked source rows with play accent: bottom bar Sources. */
export function IconSources({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3.5 6.5h13M3.5 12h11M3.5 17.5h8" />
      <path d="M16.5 13.5v7l5-3.5-5-3.5Z" />
    </>,
    stroke,
  );
}

/** Outline play triangle + vertical bar: bottom bar Next Episode. */
export function IconNextEpisode({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M5 5.6v12.8L15 12 5 5.6Z" />
      <path d="M19 5.5v13" />
    </>,
    stroke,
  );
}

/** Opposing diagonal outward arrows: bottom bar Full Screen. */
export function IconFullscreen({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M9.5 4.5H4.5v5M4.5 4.5l5.5 5.5" />
      <path d="M14.5 19.5h5v-5M19.5 19.5L14 14" />
    </>,
    stroke,
  );
}

/** Opposing diagonal inward arrows: bottom bar Crop (when cropped). */
export function IconExitFullscreen({ size = 21, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4.5 10h5.5V4.5M10 10L4.5 4.5" />
      <path d="M19.5 14H14v5.5M14 14l5.5 5.5" />
    </>,
    stroke,
  );
}

/** Four-corner expand frame: top-right desktop Full Screen toggle. */
export function IconWindowFullscreen({ size = 21, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4.5 9V5.5A1 1 0 0 1 5.5 4.5H9" />
      <path d="M15 4.5h3.5a1 1 0 0 1 1 1V9" />
      <path d="M19.5 15v3.5a1 1 0 0 1-1 1H15" />
      <path d="M9 19.5H5.5a1 1 0 0 1-1-1V15" />
    </>,
    stroke,
  );
}

/** Four-corner compress frame: top-right desktop Exit Full Screen toggle. */
export function IconWindowExitFullscreen({ size = 21, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M9 4.5V8a1 1 0 0 1-1 1H4.5" />
      <path d="M19.5 9H16a1 1 0 0 1-1-1V4.5" />
      <path d="M15 19.5V16a1 1 0 0 1 1-1h3.5" />
      <path d="M4.5 15H8a1 1 0 0 1 1 1v3.5" />
    </>,
    stroke,
  );
}

/** Picture-in-Picture outline screen with inset box. */
export function IconPip({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="11.5" y="11" width="6.5" height="4.8" rx="1" fill="currentColor" stroke="none" />
    </>,
    stroke,
  );
}

/** Cast to TV outline screen with arcs. */
export function IconCast({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3 8.5V6.8A2.2 2.2 0 0 1 5.2 4.6h13.6A2.2 2.2 0 0 1 21 6.8v10.4a2.2 2.2 0 0 1-2.2 2.2H13" />
      <path d="M3 12a7.5 7.5 0 0 1 7.5 7.5" />
      <path d="M3 15.8a3.8 3.8 0 0 1 3.8 3.8" />
      <circle cx="3.4" cy="19.2" r="0.8" fill="currentColor" stroke="none" />
    </>,
    stroke,
  );
}

/** AirPlay screen with upward triangle. */
export function IconAirPlay({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M5.5 16.5H4.2A1.7 1.7 0 0 1 2.5 14.8V6.2A1.7 1.7 0 0 1 4.2 4.5h15.6a1.7 1.7 0 0 1 1.7 1.7v8.6a1.7 1.7 0 0 1-1.7 1.7h-1.3" />
      <path d="M12 13.5l5 6H7l5-6Z" fill="currentColor" stroke="none" />
    </>,
    stroke,
  );
}

/** Padlock outline: touch lock. */
export function IconLock({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V7.8a4 4 0 0 1 8 0V11" />
    </>,
    stroke,
  );
}

/** Sun outline: left vertical brightness slider. */
export function IconSun({ size = 22, stroke = 1.65, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </>,
    stroke,
  );
}

/** Crisp solid play triangle: centre transport. */
export function IconPlaySolid({ size = 50, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable={false}>
      <path d="M6.2 3.4c0-.7.76-1.14 1.38-.78l13.2 7.6c.62.36.62 1.24 0 1.6l-13.2 7.6c-.62.36-1.38-.08-1.38-.78V3.4Z" />
    </svg>
  );
}

/** Crisp solid pause bars: centre transport. */
export function IconPauseSolid({ size = 50, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable={false}>
      <rect x="5.5" y="3.5" width="4.4" height="17" rx="1.1" />
      <rect x="14.1" y="3.5" width="4.4" height="17" rx="1.1" />
    </svg>
  );
}

/** Outline speaker wave: volume. */
export function IconVolume({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M11 5.5 6.4 9.2H3.5v5.6h2.9L11 18.5V5.5Z" />
      <path d="M15 9.2a4.2 4.2 0 0 1 0 5.6" />
      <path d="M17.8 6.8a7.8 7.8 0 0 1 0 10.4" />
    </>,
    stroke,
  );
}

/** Outline speaker muted: volume muted. */
export function IconVolumeMuted({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M11 5.5 6.4 9.2H3.5v5.6h2.9L11 18.5V5.5Z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </>,
    stroke,
  );
}

/** Outline crescent moon: sleep timer. */
export function IconMoon({ size = 21, stroke = 1.7, className }: IconProps) {
  return svg(size, className, <path d="M20.2 14.5A8.2 8.2 0 0 1 9.5 3.8a8.5 8.5 0 1 0 10.7 10.7Z" />, stroke);
}

/** Outline group icon: watch party. */
export function IconParty({ size = 21, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 18.5c0-2.8 2.4-4.8 5.5-4.8s5.5 2 5.5 4.8" />
      <circle cx="16.4" cy="9.4" r="2.2" />
      <path d="M16.5 14.2c2.1.2 3.8 1.7 3.8 4.1" />
    </>,
    stroke,
  );
}

/** Outline three dots: more menu. */
export function IconMore({ size = 22, stroke = 1.7, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>,
    stroke,
  );
}

/** Crisp thin checkmark: Audio & Subtitles, Sleep Timer, Sources. */
export function IconCheck({ size = 19, stroke = 2.1, className }: IconProps) {
  return svg(size, className, <path d="M4.5 12.6 9.4 17.5 19.5 6.8" />, stroke);
}

/** Down chevron: Episodes season pill. */
export function IconChevronDown({ size = 16, stroke = 2.1, className }: IconProps) {
  return svg(size, className, <path d="M5 8.5 12 15.5 19 8.5" />, stroke);
}

/** Sliders / tune icon: understated Audio & Subtitle settings toggle. */
export function IconTune({ size = 17, stroke = 1.75, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 7h4M12 7h8M4 17h10M18 17h2M4 12h9M17 12h3" />
      <circle cx="10" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>,
    stroke,
  );
}

/** Shuffle icon: Episodes header. */
export function IconShuffle({ size = 18, stroke = 1.75, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3.5 7h3.2c1.8 0 2.9 1 4.1 2.9l2.4 4.2c1.1 1.9 2.3 2.9 4.1 2.9h3.2" />
      <path d="M17.5 14l3 3-3 3" />
      <path d="M3.5 17h3.2c1.4 0 2.3-.6 3.2-1.8M13.8 8.8c.9-1.2 1.8-1.8 3.5-1.8h3.2" />
      <path d="M17.5 4l3 3-3 3" />
    </>,
    stroke,
  );
}

/** Thumbs down outline: top-center rating pill. */
export function IconThumbDown({ size = 18, stroke = 1.6, className }: IconProps) {
  return svg(
    size,
    className,
    <path d="M10.2 14.5 9.1 19a1.4 1.4 0 0 0 1.36 1.75h.3a1.5 1.5 0 0 0 1.37-.9L15 13.5V5H6.8a1.9 1.9 0 0 0-1.86 1.5l-1 5A1.9 1.9 0 0 0 5.8 14.5h4.4ZM15 5h3.2A1.3 1.3 0 0 1 19.5 6.3v6.2a1.3 1.3 0 0 1-1.3 1.3H15" />,
    stroke,
  );
}

/** Thumbs up outline: top-center rating pill. */
export function IconThumbUp({ size = 18, stroke = 1.6, className }: IconProps) {
  return svg(
    size,
    className,
    <path d="M13.8 9.5 14.9 5a1.4 1.4 0 0 0-1.36-1.75h-.3a1.5 1.5 0 0 0-1.37.9L9 10.5V19h8.2a1.9 1.9 0 0 0 1.86-1.5l1-5a1.9 1.9 0 0 0-1.86-3h-4.4ZM9 19H5.8a1.3 1.3 0 0 1-1.3-1.3v-6.2a1.3 1.3 0 0 1 1.3-1.3H9" />,
    stroke,
  );
}

/** Double thumbs up outline: top-center "Love this" rating pill. */
export function IconThumbLove({ size = 19, stroke = 1.5, className }: IconProps) {
  return svg(
    size,
    className,
    <>
      <path d="M10.5 10.5 11.4 6.6a1.1 1.1 0 0 0-1.08-1.35h-.2c-.48 0-.9.28-1.1.72L6.8 11V18h6.1a1.5 1.5 0 0 0 1.47-1.2l.75-3.9a1.5 1.5 0 0 0-1.47-2.4H10.5ZM6.8 18H4.6a1 1 0 0 1-1-1v-4.8a1 1 0 0 1 1-1h2.2" />
      <path d="M14.8 9.5 15.6 6a1.1 1.1 0 0 0-1.08-1.35h-.15M16.8 18h1.5a1.5 1.5 0 0 0 1.47-1.2l.75-3.9a1.5 1.5 0 0 0-1.47-2.4H15.8" />
    </>,
    stroke,
  );
}
