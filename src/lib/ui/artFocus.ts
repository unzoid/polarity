/**
 * Where across a picture its subject is, 0 (left edge) to 1 (right edge), for a screen that shows only a narrow
 * strip of a wide picture (a phone's title page). Detail (edges, texture: faces, figures, a logo) is what the eye goes
 * to; flat areas (sky, a wall, a gradient) are what gets cropped away. So it's the middle of the columns busier than
 * the picture's average, by how much busier. A picture with nothing busier anywhere is centred. `px` is RGBA, as a
 * canvas reads it, `width` pixels across.
 */
export function artFocusX(px: ArrayLike<number>, width: number): number {
  const n = Math.floor(px.length / 4);
  if (width < 3 || n < width * 2) return 0.5;
  const height = Math.floor(n / width);
  const lum = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  };
  const energy = new Float64Array(width);
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const l = lum(x, y);
      energy[x] += Math.abs(l - lum(x + 1, y)) + Math.abs(l - lum(x, y + 1));
    }
  // The last column has no neighbour to its right: it takes the one before's.
  energy[width - 1] = energy[width - 2];
  const mean = energy.reduce((a, b) => a + b, 0) / width;
  let total = 0;
  let at = 0;
  for (let x = 0; x < width; x++) {
    const k = Math.max(0, energy[x] - mean);
    total += k;
    at += k * (x + 0.5);
  }
  return total > 0 ? at / total / width : 0.5;
}

/**
 * The `object-position` across (0–1) that puts `focus` (artFocusX) in the middle of a box showing `shown` of the
 * picture's width (0–1, as `object-fit: cover` crops it), as near as the picture's edges allow.
 */
export function focusPosition(focus: number, shown: number): number {
  if (shown >= 1) return 0.5;
  return Math.min(1, Math.max(0, (focus - shown / 2) / (1 - shown)));
}
