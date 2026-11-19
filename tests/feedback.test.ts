import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FEEDBACK_KINDS, feedbackUrl, type FeedbackContext } from "../src/lib/feedback";

// Send Feedback (#205): each kind opens its own issue form, filled in only with choices that form has.

const fields = (url: string) => Object.fromEntries(new URL(url).searchParams);
const windows: FeedbackContext = { os: "windows", form: "desktop", tvDevice: false, tvMode: false, version: "0.19.0" };

/** A form's options for a dropdown field, read from the template itself, so a renamed choice fails here. */
function choices(template: string, id: string): string[] {
  const yml = readFileSync(`.github/ISSUE_TEMPLATE/${template}`, "utf8").replace(/\r\n/g, "\n");
  const block = yml.split(/\n  - type: /).find((b) => b.includes(`id: ${id}\n`));
  if (!block) throw new Error(`${template} has no field ${id}`);
  return [...block.matchAll(/^ {8}- (.+)$/gm)].map((m) => m[1].trim());
}

describe("the forms it opens", () => {
  test("each kind has its own form, and the form is in the repository", () => {
    const templates = FEEDBACK_KINDS.map((k) => fields(feedbackUrl(k.id, windows)).template);
    expect(new Set(templates).size).toBe(FEEDBACK_KINDS.length);
    for (const t of templates) expect(() => readFileSync(`.github/ISSUE_TEMPLATE/${t}`)).not.toThrow();
  });

  test("a bug from Windows says the system, the interface and the version", () => {
    expect(fields(feedbackUrl("bug", windows))).toEqual({ template: "1-bug.yml", platform: "Windows", mode: "Desktop", version: "0.19.0" });
  });

  test("every value filled in is one of its form's own choices", () => {
    const contexts: FeedbackContext[] = [
      windows,
      { os: "macos", form: "desktop", tvDevice: false, tvMode: true },
      { os: "linux", form: "desktop", tvDevice: false, tvMode: false },
      { os: "android", form: "phone", tvDevice: false, tvMode: false },
      { os: "android", form: "tablet", tvDevice: true, tvMode: true },
      { os: "ios", form: "phone", tvDevice: false, tvMode: false },
    ];
    for (const ctx of contexts)
      for (const k of FEEDBACK_KINDS) {
        const { template, version, ...picked } = fields(feedbackUrl(k.id, ctx));
        for (const [id, value] of Object.entries(picked)) expect(choices(template, id)).toContain(value);
        if (version) expect(version).toBe("0.19.0");
      }
  });

  test("an iPhone isn't among the systems the forms list: that's left for the person, the interface is still filled in", () => {
    const f = fields(feedbackUrl("bug", { os: "ios", form: "phone", tvDevice: false, tvMode: false }));
    expect(f.platform).toBeUndefined();
    expect(f.mode).toBe("Phone");
  });

  test("a TV is a TV, whatever its system", () => {
    const tv: FeedbackContext = { os: "android", form: "tablet", tvDevice: true, tvMode: true };
    expect(fields(feedbackUrl("playback", tv)).platform).toBe("Android TV / Google TV / Fire TV");
    expect(fields(feedbackUrl("idea", tv)).platform).toBe("TV");
    expect(fields(feedbackUrl("look", tv)).mode).toBe("TV mode");
  });
});
