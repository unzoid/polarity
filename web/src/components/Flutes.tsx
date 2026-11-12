import { onCleanup, onMount } from "solid-js";

/**
 * Fluted ("reeded") glass over a soft glow, drawn in WebGL. The flutes follow a shape:
 *  - flutes: straight vertical reeds
 *  - rings:  concentric circles around `origin` (the pole)
 *  - star:   concentric copies of the logo's four-point star around `origin`
 *  - rays:   wedges fanning out from `origin`
 * Each flute acts as a small lens: it shifts and mirrors the glow behind it, so the bands read as glass.
 * Colors come from the --flute-* tokens; without WebGL the box shows their plain gradient.
 */
export type FluteShape = "flutes" | "rings" | "star" | "rays";
const SHAPES: Record<FluteShape, number> = { flutes: 0, rings: 1, star: 2, rays: 3 };
const TOKENS = ["--flute-top", "--flute-bottom", "--flute-glow", "--flute-light"] as const;

type Props = {
  shape: FluteShape;
  /** Flutes per shorter side of the box; for rays, the number of wedges. */
  count: number;
  /** The pole, as a fraction of the box (x, y from the top left). */
  origin?: [number, number];
  /** Flutes per second the pattern travels outward (or around, for rays). */
  drift?: number;
  /** Lean the pattern toward the cursor (default true). */
  followPointer?: boolean;
  class?: string;
};

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uShape, uCount, uDrift, uGrain;
uniform vec2 uOrigin, uPointer;
uniform vec3 uTop, uBottom, uGlow, uLight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float field(vec2 p) {
  if (uShape < 0.5) return p.x;
  if (uShape < 1.5) return length(p);
  if (uShape < 2.5) {
    // A superellipse with an exponent under 1 is a concave four-point star, like the logo's.
    vec2 a = abs(p) + 1e-4;
    return pow(pow(a.x, 0.55) + pow(a.y, 0.55), 1.0 / 0.55);
  }
  return atan(p.y, p.x) / 6.2831853;
}

// What sits behind the glass: the page gradient with a glow at the pole and a softer one opposite.
vec3 scene(vec2 s, vec2 k) {
  vec3 c = mix(uTop, uBottom, smoothstep(-0.1, 1.1, s.y));
  vec2 a = uOrigin + vec2(0.05 * sin(uTime * 0.13), 0.06 * cos(uTime * 0.11)) + uPointer * 0.04;
  vec2 b = vec2(1.0 - uOrigin.x, 1.05) + vec2(0.08 * cos(uTime * 0.09), -0.05 * sin(uTime * 0.1));
  vec2 da = (s - a) * k, db = (s - b) * k;
  float ga = exp(-dot(da, da) * 3.0);
  float gb = exp(-dot(db, db) * 2.2);
  c = mix(c, uGlow, ga * 0.85);
  c = mix(c, uLight, ga * ga * 0.35);
  c = mix(c, uGlow, gb * 0.45);
  return c;
}

void main() {
  float m = min(uRes.x, uRes.y);
  vec2 k = uRes / m;
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 o = uOrigin * uRes + uPointer * m * 0.03;
  vec2 p = (frag - o) / m;
  float r = length(p) + 1e-4;

  float f = field(p) * uCount - uTime * uDrift;
  float id = floor(f), t = fract(f);

  // Which way each flute bends the light, and how wide it is (in units of the shorter side).
  vec2 dir = vec2(1.0, 0.0);
  float w = 1.0 / uCount;
  float fade = 1.0;
  if (uShape > 0.5 && uShape < 1.5) {
    dir = p / r;
  } else if (uShape > 1.5 && uShape < 2.5) {
    float e = 1.0 / m;
    vec2 g = vec2(field(p + vec2(e, 0.0)) - field(p - vec2(e, 0.0)), field(p + vec2(0.0, e)) - field(p - vec2(0.0, e))) / (2.0 * e);
    float slope = max(length(g), 1e-4);
    dir = g / slope;
    w = 1.0 / (uCount * slope);
  } else if (uShape > 2.5) {
    dir = vec2(-p.y, p.x) / r;
    w = r * 6.2831853 / uCount;
    fade = smoothstep(0.02, 0.22, r); // wedges get too thin to read at the pole
  }

  float lens = (0.5 - t) * w * 1.8 + (hash(vec2(id, 7.0)) - 0.5) * w * 0.5;
  vec2 q = p + dir * lens * fade;
  vec3 col = scene((o / m + q) / k, k);

  float edge = abs(t - 0.5) * 2.0;
  col *= 1.0 - 0.12 * edge * edge * edge * fade;
  col = mix(col, uLight, (1.0 - smoothstep(0.0, 0.06, t)) * 0.08 * fade);
  col += (hash(gl_FragCoord.xy) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader || !program) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("Flutes shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program!);
  return gl.getProgramParameter(program!, gl.LINK_STATUS) ? program : null;
}

/** "#rrggbb" → [r, g, b] in 0–1. The --flute-* tokens are plain hex. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.trim().replace("#", ""), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Flutes(props: Props) {
  let box!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    const program = gl && compile(gl);
    if (!gl || !program) return; // the box's CSS gradient stays

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const [uRes, uTime, uPointer] = [u("uRes"), u("uTime"), u("uPointer")];
    const uColors = [u("uTop"), u("uBottom"), u("uGlow"), u("uLight")];

    const origin = props.origin ?? [0.5, 0.5];
    gl.uniform1f(u("uShape"), SHAPES[props.shape]);
    gl.uniform1f(u("uCount"), props.count);
    gl.uniform1f(u("uDrift"), props.drift ?? 0);
    gl.uniform2f(u("uOrigin"), origin[0], origin[1]);

    const readColors = () => {
      const style = getComputedStyle(box);
      TOKENS.forEach((name, i) => gl.uniform3fv(uColors[i], rgb(style.getPropertyValue(name))));
      gl.uniform1f(u("uGrain"), parseFloat(style.getPropertyValue("--flute-grain")) || 0);
    };
    readColors();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    let time = 0;
    let last = 0;
    let raf = 0;
    let visible = false;
    const pointer = [0, 0];
    const target = [0, 0];

    const draw = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer[0], pointer[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.ready = "";
    };
    const frame = (now: number) => {
      raf = 0;
      // Clamp the step so time doesn't jump after the tab or section was away.
      time += Math.min(now - (last || now), 50) / 1000;
      last = now;
      pointer[0] += (target[0] - pointer[0]) * 0.04;
      pointer[1] += (target[1] - pointer[1]) * 0.04;
      draw();
      schedule();
    };
    const schedule = () => {
      if (raf || !visible || reduce.matches || document.hidden) {
        if (!raf) last = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const redraw = () => {
      if (!raf) draw();
    };

    const resize = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(box.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(box.clientHeight * dpr));
      redraw();
    });
    resize.observe(box);

    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    seen.observe(box);

    const onPointer = (e: PointerEvent) => {
      if (!visible) return;
      const r = box.getBoundingClientRect();
      target[0] = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      target[1] = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const onScheme = () => {
      readColors();
      redraw();
    };
    const onLost = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      visible = false;
      delete canvas.dataset.ready;
    };

    if (props.followPointer !== false) addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    scheme.addEventListener("change", onScheme);
    reduce.addEventListener("change", schedule);
    canvas.addEventListener("webglcontextlost", onLost);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", schedule);
      scheme.removeEventListener("change", onScheme);
      reduce.removeEventListener("change", schedule);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    });
  });

  return (
    <div ref={box} aria-hidden="true" class={`flutes ${props.class ?? ""}`}>
      <canvas ref={canvas} class="block size-full" />
    </div>
  );
}
