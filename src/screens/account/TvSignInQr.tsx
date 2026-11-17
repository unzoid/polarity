import { useMemo } from "react";
import { encode } from "uqr";
import { formatTvCode } from "../../lib/account";
import { tvSignInLink } from "../../lib/deepLink";

/** Light modules around the code, as the QR standard asks, so a camera finds its edges on any background. */
export const QR_QUIET = 4;

/**
 * The modules of the QR code for `text`, dark ones true, rows top to bottom, with the quiet zone
 * included. Error correction M: a link this short still comes out small (25 or 29 modules a side).
 */
export function qrModules(text: string): boolean[][] {
  const { data } = encode(text, { ecc: "M", border: 0 });
  const blank = () => Array<boolean>(data.length + QR_QUIET * 2).fill(false);
  return [
    ...Array.from({ length: QR_QUIET }, blank),
    ...data.map((row) => [...Array<boolean>(QR_QUIET).fill(false), ...row, ...Array<boolean>(QR_QUIET).fill(false)]),
    ...Array.from({ length: QR_QUIET }, blank),
  ];
}

/** One SVG path for the dark modules, a unit square each. */
function qrPath(modules: boolean[][]) {
  let d = "";
  modules.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
  return d;
}

/**
 * The TV's code as a QR code (#133): a phone's camera opens Polarity there at Settings → Account →
 * Sign in a TV with the code filled in, which still asks "Sign in on <device>?". Black on white in
 * every theme, quiet zone included; redrawn for each new code.
 */
export function TvSignInQr({ code }: { code: string }) {
  const link = tvSignInLink(code);
  const modules = useMemo(() => qrModules(link), [link]);
  const size = modules.length;
  return (
    <figure className="auth-device-qr">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`QR code for the code ${formatTvCode(code)}`}
        shapeRendering="crispEdges"
        data-link={link}
      >
        <rect width={size} height={size} fill="#fff" />
        <path d={qrPath(modules)} fill="#000" />
      </svg>
      <figcaption className="auth-fine">On an Android phone with Polarity, you can scan this with the camera instead.</figcaption>
    </figure>
  );
}
