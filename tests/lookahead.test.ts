import { describe, expect, test } from "bun:test";
import { lookaheadStatus } from "../src/lib/playback/lookahead";

describe("the lookahead setting's status line", () => {
  test("says nothing with nothing playing", () => {
    expect(lookaheadStatus(null)).toBeNull();
  });

  test("says whether it reads ahead in the video playing now, and why not", () => {
    expect(lookaheadStatus("reading")).toBe("Reading ahead in the video playing now.");
    expect(lookaheadStatus("live")).toBe("Not reading ahead in the video playing now: it's a live stream, with nothing ahead to read.");
    expect(lookaheadStatus("this-device")).toBe("Not available on this device yet.");
    for (const s of ["no-reader", "not-opened", "no-seeking", "stopped"] as const) {
      expect(lookaheadStatus(s)).toMatch(/^Not reading ahead in the video playing now: .+\.$/);
    }
  });
});
