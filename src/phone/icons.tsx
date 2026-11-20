/**
 * The phone shell's line icons: Heroicons' outline set (MIT, already the app's icon library), drawn at the
 * weight phone apps use for their bars and action rows. The few it lacks are drawn below in the same style.
 */
import ArrowDownTray from "@heroicons/react/24/outline/ArrowDownTrayIcon";
import Bell from "@heroicons/react/24/outline/BellIcon";
import Check from "@heroicons/react/24/outline/CheckIcon";
import ChevronDown from "@heroicons/react/24/outline/ChevronDownIcon";
import ChevronLeft from "@heroicons/react/24/outline/ChevronLeftIcon";
import ChevronRight from "@heroicons/react/24/outline/ChevronRightIcon";
import Cog from "@heroicons/react/24/outline/Cog6ToothIcon";
import Film from "@heroicons/react/24/outline/FilmIcon";
import MagnifyingGlass from "@heroicons/react/24/outline/MagnifyingGlassIcon";
import PaperAirplane from "@heroicons/react/24/outline/PaperAirplaneIcon";
import Pencil from "@heroicons/react/24/outline/PencilIcon";
import Plus from "@heroicons/react/24/outline/PlusIcon";
import Question from "@heroicons/react/24/outline/QuestionMarkCircleIcon";
import SpeakerWave from "@heroicons/react/24/outline/SpeakerWaveIcon";
import SpeakerXMark from "@heroicons/react/24/outline/SpeakerXMarkIcon";
import User from "@heroicons/react/24/outline/UserIcon";
import XMark from "@heroicons/react/24/outline/XMarkIcon";
import type { ComponentType, SVGProps } from "react";

type Props = { size?: number; stroke?: number; className?: string };
type Hero = ComponentType<SVGProps<SVGSVGElement>>;

function line(Icon: Hero, defaultStroke = 1.6) {
  return function PhoneIcon({ size = 24, stroke = defaultStroke, className }: Props) {
    return <Icon width={size} height={size} strokeWidth={stroke} className={className} aria-hidden focusable={false} />;
  };
}

export const IconSearch = line(MagnifyingGlass, 1.8);
export const IconBell = line(Bell, 1.6);
export const IconPlus = line(Plus, 1.5);
export const IconCheck = line(Check, 1.6);
export const IconClose = line(XMark, 1.8);
export const IconBack = line(ChevronLeft, 2);
export const IconChevronRight = line(ChevronRight, 2);
export const IconChevronDown = line(ChevronDown, 2.2);
export const IconShare = line(PaperAirplane, 1.5);
export const IconTrailer = line(Film, 1.5);
export const IconPencil = line(Pencil, 1.6);
export const IconSettings = line(Cog, 1.6);
export const IconAccount = line(User, 1.6);
export const IconHelp = line(Question, 1.6);
export const IconSound = line(SpeakerWave, 1.8);
export const IconMuted = line(SpeakerXMark, 1.8);
export const IconDownloadTray = line(ArrowDownTray, 1.6);

const svg = (size: number, className: string | undefined, children: React.ReactNode, viewBox = "0 0 24 24") => (
  <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden focusable={false}>
    {children}
  </svg>
);

/** A house with a bar for a door, as the bar's Home. */
export function IconHome({ size = 24, stroke = 1.7, className }: Props) {
  return svg(
    size,
    className,
    <>
      <path strokeWidth={stroke} d="M4.5 10.2 12 4.6l7.5 5.6V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z" />
      <path strokeWidth={stroke} d="M9.5 15.2h5" />
    </>,
  );
}

/** Down arrow onto a line: the bar's Downloads. */
export function IconDownload({ size = 24, stroke = 1.7, className }: Props) {
  return svg(
    size,
    className,
    <>
      <path strokeWidth={stroke} d="M12 3.5v12.2M7 10.9l5 5 5-5" />
      <path strokeWidth={stroke} d="M3.8 20h16.4" />
    </>,
  );
}

/** A finger's "pick the source" glyph: stacked lines with a play mark. */
export function IconSources({ size = 24, stroke = 1.5, className }: Props) {
  return svg(
    size,
    className,
    <>
      <path strokeWidth={stroke} d="M3.5 6.5h11M3.5 12h11M3.5 17.5h7" />
      <path strokeWidth={stroke} d="M16.5 14v7l5-3.5z" />
    </>,
  );
}

/** A filled "i" in a circle: a season's details, beside its name. */
export function IconInfo({ size = 24, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable={false}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <circle cx="12" cy="7.4" r="1.45" fill="#000" />
      <rect x="10.7" y="10" width="2.6" height="8" rx="1.1" fill="#000" />
    </svg>
  );
}

/** The play triangle, filled, slightly rounded. */
export function IconPlay({ size = 24, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable={false}>
      <path fill="currentColor" d="M6.5 3.9c0-.8.9-1.3 1.6-.9l12.2 8.1c.6.4.6 1.3 0 1.7L8.1 20.9c-.7.5-1.6 0-1.6-.8z" />
    </svg>
  );
}

/** A play triangle in a ring: Search's "play now" beside each suggestion. */
export function IconPlayRing({ size = 36, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" className={className} aria-hidden focusable={false}>
      <circle cx="18" cy="18" r="16.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path fill="currentColor" d="M14.4 11.6c0-.6.7-1 1.2-.7l9.4 6.2c.5.3.5 1 0 1.3l-9.4 6.2c-.5.3-1.2-.1-1.2-.7z" />
    </svg>
  );
}

/** Leaving: a door with an arrow out, the sheet's Sign Out. */
export function IconSignOut({ size = 24, stroke = 1.6, className }: Props) {
  return svg(
    size,
    className,
    <>
      <path strokeWidth={stroke} d="M13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h7.5" />
      <path strokeWidth={stroke} d="M10 12h10m-3.5-3.5L20 12l-3.5 3.5" />
    </>,
  );
}

/** The Polarity star (the "o" of the wordmark), for the bar beside a page's name. */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable={false}>
      <path fill="currentColor" d="M12 1.2c.5 5.6 2.6 9.2 10.8 10.8C14.6 13.6 12.5 17.2 12 22.8 11.5 17.2 9.4 13.6 1.2 12 9.4 10.4 11.5 6.8 12 1.2z" />
    </svg>
  );
}

/** A flame drawn in the bar's line style: the Anime section, as its Settings page marks it. */
export function IconAnime({ size = 24, stroke = 1.7, className }: Props) {
  return svg(
    size,
    className,
    <path
      strokeWidth={stroke}
      d="M12 21c-3.6 0-6.3-2.6-6.3-6 0-2.5 1.4-4.4 2.9-5.9.4 1.4 1.3 2.4 2.3 2.8-.3-3.4 1.2-6.4 4.1-8.4-.2 2.8.9 4.7 2.4 6.4 1.6 1.7 2.9 3.4 2.9 5.4 0 3.2-2.8 5.7-6.3 5.7zm0 0c-1.7 0-2.9-1.2-2.9-2.8 0-1.4.9-2.4 1.9-3.3.3.8.9 1.3 1.6 1.4.1-1.1.5-2 1.2-2.7.9 1.1 1.4 2.2 1.4 3.4 0 2.4-1.5 4-3.2 4z"
    />,
  );
}
