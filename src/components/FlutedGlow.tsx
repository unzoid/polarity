import { useEffect, useRef } from "react";

/**
 * The account screens' backdrop: the accent glow seen through fluted glass, its reeds concentric copies
 * of the logo's four-point star around the top-right corner (as on the website). Drawn in WebGL; the
 * reeds drift outward slowly and the pattern leans a little toward the cursor.
 *
 * The scene behind the glass is --bg with an --accent glow, so the reeds only show where there's light
 * to bend and the rest of the window stays plain. Without WebGL (or once the context is lost) the box's
 * CSS gradient shows instead. Reduced motion draws one still frame.
 */

// The pole of the star, its glow (fractions of the box), the glow's radius (fractions of the shorter side).
const ORIGIN = [0.92, -0.02];
const GLOW = [0.86, 0];
const GLOW_SIZE = 0.62;
const STRENGTH = 0.32; // how much accent the glow carries at its brightest
const UNDER = 0.04; // a softer glow, low and opposite
const REEDS = 6; // per shorter side
const DRIFT = 0.02; // reeds per second, outward

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes, uPointer, uGlow;
uniform float uTime;
uniform vec3 uBg, uAccent;

const vec2 ORIGIN = vec2(${ORIGIN[0]}, ${ORIGIN[1]});
const float REEDS = ${REEDS.toFixed(1)};

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// A superellipse with an exponent under 1 is a concave four-point star, like the logo's.
float field(vec2 p) {
  vec2 a = abs(p) + 1e-4;
  return pow(pow(a.x, 0.55) + pow(a.y, 0.55), 1.0 / 0.55);
}

// Behind the glass: --bg and the accent glow (drifting a little). .w is how lit the point is, so the
// reeds' shading stays inside the light.
vec4 scene(vec2 s) {
  vec2 a = uGlow + vec2(0.03 * sin(uTime * 0.13), 0.035 * cos(uTime * 0.11)) + uPointer * 0.03;
  vec2 b = vec2(uRes.x / min(uRes.x, uRes.y) - uGlow.x, 1.1);
  float ga = exp(-dot(s - a, s - a) / ${(GLOW_SIZE * GLOW_SIZE).toFixed(4)});
  float gb = exp(-dot(s - b, s - b) / 0.5);
  return vec4(mix(uBg, uAccent, ga * ${STRENGTH.toFixed(3)} + gb * ${UNDER.toFixed(3)}), ga);
}

void main() {
  float m = min(uRes.x, uRes.y);
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 o = ORIGIN * uRes + uPointer * m * 0.025;
  vec2 p = (frag - o) / m;

  float f = field(p) * REEDS - uTime * ${DRIFT.toFixed(3)};
  float id = floor(f), t = fract(f);

  // Each reed is a small lens across the star's contour: it shifts and mirrors the glow behind it.
  float e = 1.0 / m;
  vec2 g = vec2(field(p + vec2(e, 0.0)) - field(p - vec2(e, 0.0)), field(p + vec2(0.0, e)) - field(p - vec2(0.0, e))) / (2.0 * e);
  float slope = max(length(g), 1e-4);
  float w = 1.0 / (REEDS * slope);
  float lens = (0.5 - t) * w * 1.8 + (hash(vec2(id, 7.0)) - 0.5) * w * 0.5;
  vec4 sc = scene(o / m + p + (g / slope) * lens);
  vec3 col = sc.rgb;

  // Darkened edges and a lit leading lip, scaled by the light, so dark parts show no lines.
  float edge = abs(t - 0.5) * 2.0;
  float lit = clamp(sc.w * 1.4, 0.0, 1.0);
  col *= 1.0 - 0.16 * edge * edge * edge * lit;
  col = mix(col, uAccent * 1.4 + 0.15, (1.0 - smoothstep(0.0, 0.05, t)) * 0.07 * lit);
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("FlutedGlow shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** A colour token as [r, g, b] in 0–1. The theme's tokens are color-mix()es, so a 1px canvas resolves them. */
function tokenRgb(el: Element, name: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

export function FlutedGlow({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current!;
    // Made here rather than rendered, so a remount (StrictMode) gets a fresh context, not the lost one.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    const program = gl && compile(gl);
    if (!gl || !program) return; // the CSS gradient stays
    el.appendChild(canvas);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    const [uRes, uTime, uPointer, uGlow, uBg, uAccent] = ["uRes", "uTime", "uPointer", "uGlow", "uBg", "uAccent"].map((n) =>
      gl.getUniformLocation(program, n),
    );

    const readColors = () => {
      gl.uniform3fv(uBg, tokenRgb(el, "--bg"));
      gl.uniform3fv(uAccent, tokenRgb(el, "--accent"));
    };
    readColors();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let time = 0;
    let last = 0;
    let raf = 0;
    let lost = false;
    const pointer = [0, 0];
    const target = [0, 0];

    const draw = () => {
      if (lost) return;
      const m = Math.min(canvas.width, canvas.height);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      // The glow is placed in shorter-side units, so it stays round in any window shape.
      gl.uniform2f(uGlow, (GLOW[0] * canvas.width) / m, (GLOW[1] * canvas.height) / m);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer[0], pointer[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.ready = "";
    };
    const frame = (now: number) => {
      raf = 0;
      // Clamp the step so time doesn't jump after the window was hidden.
      time += Math.min(now - (last || now), 50) / 1000;
      last = now;
      pointer[0] += (target[0] - pointer[0]) * 0.04;
      pointer[1] += (target[1] - pointer[1]) * 0.04;
      draw();
      schedule();
    };
    const schedule = () => {
      if (raf || lost || reduce.matches || document.hidden) {
        if (!raf) last = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const resize = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(el.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(el.clientHeight * dpr));
      if (!raf) draw();
    });
    resize.observe(el);
    schedule();

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      target[0] = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      target[1] = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    // A theme change (accent, scheme) re-reads the colours.
    const themed = new MutationObserver(() => {
      readColors();
      if (!raf) draw();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-scheme"] });
    const onLost = () => {
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
      delete canvas.dataset.ready;
    };

    addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    reduce.addEventListener("change", schedule);
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      themed.disconnect();
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", schedule);
      reduce.removeEventListener("change", schedule);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  return <div ref={box} className={className} aria-hidden />;
}
