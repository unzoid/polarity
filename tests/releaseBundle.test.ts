import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleProblems, DEV_ONLY_MARKERS, findMarkers } from "../scripts/releaseBundle";

function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "polar-bundle-test-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const every = DEV_ONLY_MARKERS.map((m) => `"${m.text}"`).join(";");

test("a release bundle without the dev-only parts passes", () => {
  const release = bundle({ "index.html": "<div id=root></div>", "assets/index-abc.js": "console.log(`Polarity`)" });
  const dev = bundle({ "assets/index-abc.js": every });
  try {
    expect(findMarkers(release)).toEqual([]);
    expect(bundleProblems(release, dev)).toEqual([]);
  } finally {
    rmSync(release, { recursive: true });
    rmSync(dev, { recursive: true });
  }
});

test("a dev-only part in the release bundle fails, naming the file", () => {
  const release = bundle({ "assets/Player-abc.js": "children:`Copy Watch Log`", "assets/fonts/x.woff2": "Copy Watch Log" });
  const dev = bundle({ "assets/index-abc.js": every });
  try {
    expect(findMarkers(release).map((m) => m.file)).toEqual([join("assets", "Player-abc.js")]);
    expect(bundleProblems(release, dev)).toEqual(['The release bundle has the watch log\'s button: "Copy Watch Log" in assets/Player-abc.js']);
  } finally {
    rmSync(release, { recursive: true });
    rmSync(dev, { recursive: true });
  }
});

test("a marker the dev bundle lacks is reported, so markers can't go stale", () => {
  const release = bundle({ "assets/index-abc.js": "" });
  const dev = bundle({ "assets/index-abc.js": every.replace('"Polarity watch log"', "") });
  try {
    expect(bundleProblems(release, dev)).toEqual(['The dev bundle lacks "Polarity watch log" (the watch log): update the marker in scripts/releaseBundle.ts']);
  } finally {
    rmSync(release, { recursive: true });
    rmSync(dev, { recursive: true });
  }
});
