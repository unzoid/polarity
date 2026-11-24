import { expect, test } from "bun:test";
import { keepsPx, scaleValue } from "../scripts/pointScale";

test("px lengths are drawn in points, falling back to px where no point is set", () => {
  expect(scaleValue("13px")).toBe("calc(13 * var(--ui-pt, 1px))");
  expect(scaleValue("0 12px 0 14px")).toBe("0 calc(12 * var(--ui-pt, 1px)) 0 calc(14 * var(--ui-pt, 1px))");
  expect(scaleValue("translate(-50%, -6.5px)")).toBe("translate(-50%, calc(-6.5 * var(--ui-pt, 1px)))");
  expect(scaleValue("clamp(148px, 24vw, calc(210 * var(--pt)))")).toBe("clamp(calc(148 * var(--ui-pt, 1px)), 24vw, calc(210 * var(--pt)))");
  expect(scaleValue("0 2px 8px rgb(0 0 0 / 0.5)")).toBe("0 calc(2 * var(--ui-pt, 1px)) calc(8 * var(--ui-pt, 1px)) rgb(0 0 0 / 0.5)");
});

test("hairlines, other units, urls and strings stay as written", () => {
  expect(scaleValue("1px solid rgb(255 255 255 / 0.1)")).toBe("1px solid rgb(255 255 255 / 0.1)");
  expect(scaleValue("0.5px")).toBe("0.5px");
  expect(scaleValue("-1px")).toBe("-1px");
  expect(scaleValue("calc(100% - 2rem)")).toBe("calc(100% - 2rem)");
  expect(scaleValue("url(\"data:image/svg+xml;utf8,<svg width='180px'/>\") 0 0 / 180px")).toBe(
    "url(\"data:image/svg+xml;utf8,<svg width='180px'/>\") 0 0 / calc(180 * var(--ui-pt, 1px))",
  );
  expect(scaleValue('"12px"')).toBe('"12px"');
  expect(scaleValue("#12px")).toBe("#12px");
});

test("the point variables themselves keep their px", () => {
  expect(keepsPx("--pt")).toBe(true);
  expect(keepsPx("--pl-pt")).toBe(true);
  expect(keepsPx("--ui-pt")).toBe(true);
  expect(keepsPx("--hit")).toBe(false);
  expect(keepsPx("width")).toBe(false);
});
