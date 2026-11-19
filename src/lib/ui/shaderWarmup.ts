/**
 * The GPU builds a shader for each blur radius the first time it draws one, and again for each kind of thing
 * blurred (text, a picture). The blur-in entrances (`rise` on a title page, `hero-content-in`,
 * `status-text-in`, … from 4px; `icon-swap`, `btn-glyph-in` from 2px) pass through a dozen radii in their
 * first frames, and a title page's art adds its own big blur: on a first run those builds land mid-animation,
 * a few hundred milliseconds of dropped frames on the GPU thread. So once the app has settled (App.tsx), before
 * a title page is opened, each is drawn once, invisibly, in a single frame: paused copies of a real entrance
 * (base.css `.shader-warmup`), each frozen at another blur, over text and over a picture, and a picture with
 * the title page's art filter. The shaders then build together, in one burst, while nothing moves. Not at
 * start-up: there the burst held up Home's first frames by about 100 ms. The web view keeps them in its
 * shader cache after that.
 */

/** A blur-in entrance and the blur it starts from (css px). The others share these two's blurs. */
const ENTRANCES: readonly (readonly [name: string, fromPx: number])[] = [
  ["rise", 4],
  ["icon-swap", 2],
];
/** Blur steps (css px): fine enough to land in every radius at any device pixel ratio. */
const STEP = 0.125;

/** A small picture with nothing to see: every pixel all but transparent (not fully, or it isn't drawn). */
function faintPicture(): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "rgb(128 128 128 / 0.004)";
  ctx.fillRect(0, 0, 16, 16);
  return canvas.toDataURL("image/png");
}

export function warmUpBlurShaders() {
  const box = document.createElement("div");
  box.className = "shader-warmup";
  box.setAttribute("aria-hidden", "true");
  const picture = faintPicture();
  const frozen = (el: HTMLElement, name: string, from: number, blur: number) => {
    el.style.animationName = name;
    // `linear` over 1s (base.css): this far in, the blur is exactly `blur`.
    el.style.animationDelay = `${-(1 - blur / from)}s`;
    box.append(el);
  };
  const pictures: HTMLImageElement[] = [];
  const img = (className?: string) => {
    const el = document.createElement("img");
    el.alt = "";
    if (className) el.className = className;
    el.src = picture!;
    pictures.push(el);
    return el;
  };
  for (const [name, from] of ENTRANCES) {
    for (let blur = STEP; blur < from; blur += STEP) {
      const text = document.createElement("span");
      text.textContent = "Aa";
      frozen(text, name, from, blur);
      if (picture) frozen(img(), name, from, blur);
    }
  }
  // A title page's art behind its hero (detail.css), blurred at its own size.
  if (picture) box.append(img("detail-bg-blur"));
  const show = () => {
    document.body.append(box);
    // Drawn in the next frame; gone the one after.
    requestAnimationFrame(() => requestAnimationFrame(() => box.remove()));
  };
  // The pictures are decoded first, so the frame that draws them has them.
  void Promise.all(pictures.map((p) => p.decode().catch(() => {}))).then(show);
}
