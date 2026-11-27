import logo from "../../assets/polarity-white.png";

/** The sign-in's mark: the Polarity wordmark, and nothing else. */
export function SignInMark({ className }: { className?: string }) {
  return <img className={className ? `si-mark wordmark ${className}` : "si-mark wordmark"} src={logo} alt="Polarity" draggable={false} />;
}
