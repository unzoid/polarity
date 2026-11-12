import { formFactor, isTvDevice, os, type FormFactor, type Os } from "./platform";

/**
 * Send Feedback (#205): the repository's own issue forms (.github/ISSUE_TEMPLATE), opened in the browser and
 * filled in with what the app knows about where it runs. Nothing is sent from the app, and there's no server,
 * token or telemetry: the person reads the form, adds what they want and sends it themselves.
 */

const ISSUES = "https://github.com/unzoid/polarity/issues/new";

/** For people without a GitHub account (TERMS.md). */
export const FEEDBACK_EMAIL = "support@getpolar.app";

export type FeedbackKind = "bug" | "playback" | "look" | "idea";

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string; caption: string }[] = [
  { id: "bug", label: "Something doesn't work", caption: "A bug, a crash or an error" },
  { id: "playback", label: "Playback or a source doesn't work", caption: "A video that doesn't start, stutters or loses sync" },
  { id: "look", label: "Looks or feels off", caption: "Layout, text, motion or anything that feels wrong" },
  { id: "idea", label: "Idea or feature request", caption: "Something Polarity could do" },
];

/** Where it runs, as the forms ask for it. */
export interface FeedbackContext {
  os: Os;
  form: FormFactor;
  /** Running on a TV (Android TV, Google TV, Fire TV). */
  tvDevice: boolean;
  /** In TV mode now. */
  tvMode: boolean;
  /** "0.19.0", when known. */
  version?: string;
}

/** This device now. TV mode is read from the root's `data-tv`, which tv/tvMode.ts keeps (lib doesn't reach into tv/). */
export function feedbackContext(version?: string): FeedbackContext {
  const tvMode = typeof document !== "undefined" && document.documentElement.dataset.tv === "true";
  return { os, form: formFactor().form, tvDevice: isTvDevice, tvMode, version };
}

/** The forms' "Where you saw it" choices (1-bug, 2-playback); iOS isn't among them yet, so it's left for the person. */
function systemChoice({ os, tvDevice }: FeedbackContext): string | undefined {
  if (tvDevice) return "Android TV / Google TV / Fire TV";
  return { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android phone or tablet", ios: undefined }[os];
}

/** The forms' "Interface" choices (1-bug, 5-look-and-feel). */
const interfaceChoice = ({ tvMode, form }: FeedbackContext) => (tvMode ? "TV mode" : form === "desktop" ? "Desktop" : "Phone");

/** The feature form's "Which devices it matters on" (6-feature). */
const deviceChoice = ({ tvMode, tvDevice, form }: FeedbackContext) =>
  tvMode || tvDevice ? "TV" : form === "desktop" ? "Desktop (Windows, macOS, Linux)" : "Phone or tablet";

/**
 * The issue form for `kind`, its fields filled in by their ids (GitHub fills a form's fields from the query).
 * Only choices the form has are filled; the rest stays for the person.
 */
export function feedbackUrl(kind: FeedbackKind, ctx: FeedbackContext): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | undefined) => v && q.set(k, v);
  switch (kind) {
    case "bug":
      q.set("template", "1-bug.yml");
      set("platform", systemChoice(ctx));
      set("mode", interfaceChoice(ctx));
      set("version", ctx.version);
      break;
    case "playback":
      q.set("template", "2-playback.yml");
      set("platform", systemChoice(ctx));
      set("version", ctx.version);
      break;
    case "look":
      q.set("template", "5-look-and-feel.yml");
      set("mode", interfaceChoice(ctx));
      break;
    case "idea":
      q.set("template", "6-feature.yml");
      set("platform", deviceChoice(ctx));
      break;
  }
  return `${ISSUES}?${q}`;
}
