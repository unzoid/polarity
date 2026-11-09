import { describe, expect, test } from "bun:test";
import { assColor, dialogueOverrides, dialogueStyles, parseAssHeader } from "../src/components/player/assStyles";

// An invented release's header, as mpv's sub-ass-extradata gives it.
const HEADER = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "PlayResX: 1920",
  "PlayResY: 1080",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Default,Rounded Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3.6,1.5,2,120,120,60,1",
  "Style: Default - Italics,Rounded Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,-1,0,0,100,100,0,0,1,3.6,1.5,2,120,120,60,1",
  "Style: Sign - Shop,Brush Script,48,&H00202020,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,10,10,10,1",
  "Style: OP Romaji,Thin Serif,54,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
].join("\r\n");

describe("parseAssHeader", () => {
  test("reads the canvas height and every style's name, font and alignment", () => {
    const header = parseAssHeader(HEADER);
    expect(header.playResY).toBe(1080);
    expect(header.styles.map((s) => [s.name, s.font, s.alignment])).toEqual([
      ["Default", "Rounded Sans", 2],
      ["Default - Italics", "Rounded Sans", 2],
      ["Sign - Shop", "Brush Script", 8],
      ["OP Romaji", "Thin Serif", 8],
    ]);
  });

  test("a script without PlayResY is on libass's 288-line canvas", () => {
    expect(parseAssHeader("[Script Info]\nTitle: x").playResY).toBe(288);
  });
});

describe("dialogueStyles", () => {
  test("dialogue styles by name; signs and songs left out", () => {
    expect(dialogueStyles(parseAssHeader(HEADER).styles).map((s) => s.name)).toEqual(["Default", "Default - Italics"]);
  });

  test("no dialogue-like name: the bottom-centred styles that aren't signs, else the first", () => {
    const style = (name: string, alignment: number) => ({ name, font: "F", alignment });
    expect(dialogueStyles([style("Sign", 2), style("Speech", 2), style("Card", 8)]).map((s) => s.name)).toEqual(["Speech"]);
    expect(dialogueStyles([style("Card", 8), style("Banner", 7)]).map((s) => s.name)).toEqual(["Card"]);
  });
});

test("ASS colours are &HAABBGGRR with 00 opaque", () => {
  expect(assColor("#FFE45C")).toBe("&H005CE4FF");
  expect(assColor("#000000", 75)).toBe("&H40000000");
  expect(assColor("#FFFFFF", 0)).toBe("&HFFFFFFFF");
});

describe("dialogueOverrides", () => {
  const header = parseAssHeader(HEADER);

  test("nothing to change: no overrides, the release looks as made", () => {
    expect(dialogueOverrides(header, {})).toEqual([]);
  });

  test("a colour change keeps the font and touches only the dialogue styles", () => {
    const overrides = dialogueOverrides(header, { text: { color: "#FFE45C", opacity: 100 } });
    expect(overrides).toEqual(["Default.PrimaryColour=&H005CE4FF", "Default - Italics.PrimaryColour=&H005CE4FF"]);
    expect(overrides.some((o) => /Fontname|Sign|OP/.test(o))).toBe(false);
  });

  test("a picked font goes on the dialogue styles only, drawn regular", () => {
    expect(dialogueOverrides(header, { font: "Segoe UI Semibold" })).toEqual([
      "Default.Fontname=Segoe UI Semibold",
      "Default.Bold=0",
      "Default - Italics.Fontname=Segoe UI Semibold",
      "Default - Italics.Bold=0",
    ]);
  });

  test("outline widths move from mpv's 720-line canvas to the script's", () => {
    const overrides = dialogueOverrides(header, { outline: { width: 2.6, color: "#4A4A4A", opacity: 100 } });
    expect(overrides).toContain("Default.Outline=3.9");
    expect(overrides).toContain("Default.OutlineColour=&H004A4A4A");
    expect(dialogueOverrides(header, { outline: { width: 0, color: "#000000", opacity: 100 } })).toContain("Default.Shadow=0");
  });

  test("a box is an opaque border in the box's colour", () => {
    const overrides = dialogueOverrides(header, { box: 75 });
    expect(overrides).toContain("Default.BorderStyle=3");
    expect(overrides).toContain("Default.OutlineColour=&H40000000");
  });

  test("no styles known (no header): the usual Default style", () => {
    expect(dialogueOverrides(parseAssHeader(""), { text: { color: "#FFFFFF", opacity: 50 } })).toEqual(["Default.PrimaryColour=&H80FFFFFF"]);
  });
});
