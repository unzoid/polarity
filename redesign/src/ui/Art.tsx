import { useState, type ImgHTMLAttributes } from "react";
import { imageBroken, imageLoaded, markImageBroken, markImageLoaded } from "../../../src/lib/ui";

/**
 * A picture that fades in once decoded and moves on to the next of `sources` when one fails. When none loads,
 * the frame stays as a quiet surface with the title's name, so a missing picture never leaves a hole.
 */
export function Art({
  sources,
  name,
  className = "",
  ...props
}: { sources: (string | null | undefined)[]; name?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const [, setFailures] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const chain = sources.filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const current = chain.find((u) => !imageBroken(u));
  if (!current) {
    return name ? (
      <span className={`art-missing ${className}`} aria-hidden>
        {name}
      </span>
    ) : null;
  }
  return (
    <img
      key={current}
      alt=""
      decoding="async"
      loading="lazy"
      draggable={false}
      {...props}
      src={current}
      className={`img-fade ${className}`}
      data-loaded={loaded === current || imageLoaded(current)}
      onLoad={() => {
        setLoaded(current);
        markImageLoaded(current);
      }}
      onError={() => {
        markImageBroken(current);
        setFailures((n) => n + 1);
      }}
    />
  );
}
