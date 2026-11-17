import type { ButtonHTMLAttributes, ComponentType, ReactNode, SVGProps } from "react";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Three kinds. `primary`: the one action a screen is for, an off-white fill. `secondary`: a raised surface with a
 * hairline. `quiet`: text only, for "See all" and the like.
 */
export function Button({
  kind = "secondary",
  size = "regular",
  icon: IconC,
  children,
  className = "",
  ...props
}: {
  kind?: "primary" | "secondary" | "quiet";
  size?: "regular" | "large";
  icon?: Icon;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn-${kind} btn-${size} ${className}`} {...props}>
      {IconC && <IconC className="btn-icon" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

/** A square button with only an icon; `label` is what it says to a screen reader and in its tooltip. */
export function IconButton({
  icon: IconC,
  label,
  className = "",
  ...props
}: { icon: Icon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      <IconC aria-hidden />
    </button>
  );
}
