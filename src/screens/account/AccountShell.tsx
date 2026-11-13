import type { ReactNode } from "react";
import logo from "../../assets/polarity-white.png";
import { FlutedGlow } from "../../components/FlutedGlow";
import { WindowControls } from "../../components/WindowControls";

/** Full-window frame for the account screens: brand, drag region, window buttons. */
export function AccountShell({
  children,
  header,
  plain = false,
  leaving = false,
}: {
  children: ReactNode;
  header?: ReactNode;
  plain?: boolean;
  /** On its way out over the app, which is already drawn underneath (see App's Gate). */
  leaving?: boolean;
}) {
  return (
    <div className="account-shell" data-plain={plain || undefined} data-leaving={leaving || undefined}>
      {!plain && <FlutedGlow className="account-glow" />}
      <header className="account-bar" data-tauri-drag-region>
        {/* Plain (sign-in): the mark sits over the form instead. */}
        <span className="account-brand" data-tauri-drag-region>
          {!plain && <img className="brand-logo wordmark" src={logo} alt="Polarity" draggable={false} />}
        </span>
        {header}
        <WindowControls />
      </header>
      <main className="account-main">{children}</main>
    </div>
  );
}
