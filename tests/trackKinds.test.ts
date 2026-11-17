import { describe, expect, test } from "bun:test";
import { bestAudio, bestSubtitle, forcedSubtitle, kindTags, trackKind } from "../src/components/player/trackKinds";

describe("trackKind", () => {
  test("reads mpv's flags", () => {
    expect(trackKind({ forced: true })).toMatchObject({ forced: true, sdh: false });
    expect(trackKind({ "hearing-impaired": true })).toMatchObject({ sdh: true });
    expect(trackKind({ "visual-impaired": true })).toMatchObject({ description: true });
  });

  test("reads the usual titles", () => {
    expect(trackKind({ title: "English (SDH)" }).sdh).toBe(true);
    expect(trackKind({ title: "Signs & Songs" }).forced).toBe(true);
    expect(trackKind({ title: "Forced" }).forced).toBe(true);
    expect(trackKind({ title: "Director's Commentary" }).commentary).toBe(true);
    expect(trackKind({ title: "English - Audio Description" }).description).toBe(true);
    expect(trackKind({ kind: "captions" }).sdh).toBe(true);
  });

  test("leaves plain titles alone", () => {
    expect(trackKind({ title: "English" })).toEqual({ forced: false, sdh: false, description: false, commentary: false });
    // Words that merely contain the tags.
    expect(trackKind({ title: "Accented dialogue, Ccaption" })).toEqual({ forced: false, sdh: false, description: false, commentary: false });
  });

  test("tags only what the title doesn't say", () => {
    expect(kindTags({ title: "English", "hearing-impaired": true })).toEqual(["SDH"]);
    expect(kindTags({ title: "English SDH", "hearing-impaired": true })).toEqual([]);
    expect(kindTags({ forced: true })).toEqual(["Forced"]);
  });
});

describe("choosing among tracks in one language", () => {
  const forced = { title: "Forced", id: 1 };
  const sdh = { title: "SDH", id: 2 };
  const plain = { title: "English", id: 3 };

  test("a full subtitle over the signs-only one", () => {
    expect(bestSubtitle([forced, plain], false)?.id).toBe(3);
    expect(bestSubtitle([forced], false)?.id).toBe(1);
  });

  test("SDH as preferred, else the first", () => {
    expect(bestSubtitle([sdh, plain], false)?.id).toBe(3);
    expect(bestSubtitle([plain, sdh], true)?.id).toBe(2);
    expect(bestSubtitle([plain], true)?.id).toBe(3);
  });

  test("the forced track for speech that's already understood", () => {
    expect(forcedSubtitle([plain, forced])?.id).toBe(1);
    expect(forcedSubtitle([plain, sdh])).toBeUndefined();
  });

  test("the film's own sound over a description or commentary", () => {
    const ad = { title: "Audio Description", id: 1 };
    const commentary = { title: "Commentary", id: 2 };
    const main = { title: "", id: 3 };
    expect(bestAudio([ad, commentary, main])?.id).toBe(3);
    expect(bestAudio([ad])?.id).toBe(1);
  });
});
