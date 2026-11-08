import { expect, test } from "bun:test";
import { Pin, Pinned } from "../../src/components/icons";
import { render } from "./render";

test("Pin window's pushpin (#332) has a cut drawn for each size, tilted unpinned and upright pinned", async () => {
  for (const [size, grid] of [
    [14, 16],
    [16, 16],
    [18, 20],
    [20, 20],
    [22, 24],
    [24, 24],
  ]) {
    const { container, unmount } = await render(
      <>
        <Pin size={size} />
        <Pinned size={size} />
      </>,
    );
    const [unpinned, pinned] = container.querySelectorAll("svg");
    for (const svg of [unpinned, pinned]) {
      expect(svg.getAttribute("viewBox")).toBe(`0 0 ${grid} ${grid}`);
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.querySelectorAll("path").length).toBe(3);
    }
    expect(unpinned.querySelector("g")?.getAttribute("transform")).toContain(`rotate(45 ${grid / 2} ${grid / 2})`);
    expect(pinned.querySelector("g")).toBeNull();
    await unmount();
  }
});
