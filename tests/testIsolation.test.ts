import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `bun test` runs every file of a suite in one process, in an order that isn't fixed (it differs between CI
 * runners). A module mocked with `mock.module` stays mocked for every file that runs after it, so a file that
 * mocks one of the app's modules makes the others pass or fail by where they land in the order (#510).
 * The DOM suite (tests/dom) runs in its own process.
 */
const TESTS = import.meta.dir;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "dom" ? [] : files(join(dir, e.name))) : /\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

test("no test in the shared process mocks a module: fake the native side or pass the dependency in instead (#510)", () => {
  const mocking = files(TESTS)
    .filter((f) => /\bmock\.module\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(TESTS, f));
  expect(mocking).toEqual([]);
});
