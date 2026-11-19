import { useEffect, type ReactNode } from "react";
import logo from "../../assets/polarity-white.png";
import { FlutedGlow } from "../../components/FlutedGlow";
import { WindowControls } from "../../components/WindowControls";
import { KEY_DIRS, move, ownsArrows } from "../../tv/spatial";
import { playSound } from "../../tv/sounds";
import { useTvMode } from "../../tv/tvMode";

/** Full-window frame for the account screens: brand, drag region, window buttons. */
export function AccountShell({
  children,
  header,
  plain = false,
  leaving = false,
  handoffGo = false,
}: {
  children: ReactNode;
  header?: ReactNode;
  plain?: boolean;
  /** On its way out over the app, which is already drawn underneath (see App's Gate). */
  leaving?: boolean;
  /** Set one frame after leaving once the app underneath has committed, so the fade doesn't race first-boot layout. */
  handoffGo?: boolean;
}) {
  const tv = useTvMode();
  useTvArrows(tv && !leaving);

  return (
    <div
      className="account-shell"
      data-plain={plain || undefined}
      data-leaving={leaving || undefined}
      data-handoff-go={handoffGo || undefined}
      data-nav-scope={tv || undefined}
    >
      {!plain && <FlutedGlow className="account-glow" paused={leaving} />}
      <header className="account-bar" data-tauri-drag-region>
        {/* Plain (sign-in): the mark sits over the form instead. */}
        <span className="account-brand" data-tauri-drag-region>
          {!plain && <img className="brand-logo wordmark" src={logo} alt="Polarity" draggable={false} />}
        </span>
        {header}
        {/* TV mode is fullscreen: no window to minimise or close. */}
        {!tv && <WindowControls />}
      </header>
      <main className="account-main">{children}</main>
    </div>
  );
}

/**
 * In TV mode the account screens come before TvApp, which moves focus for the rest of the app: here the
 * arrows (and a controller's D-pad, which sends them) move focus the same way.
 */
function useTvArrows(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (!dir || e.defaultPrevented || ownsArrows(e.target)) return;
      e.preventDefault();
      playSound(move(dir) ? "move" : "edge");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
}
