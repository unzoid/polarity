import { appWindow as win, isDesktop, isMac } from "../lib/platform";

/**
 * Minimise / maximise / close for the frameless window on Windows and Linux; macOS has its own traffic lights, phones and tablets no window.
 * `pinned` (the player's Pin window, #266): minimise and maximise are off, close still works.
 */
export function WindowControls({ pinned = false }: { pinned?: boolean }) {
  if (isMac || !isDesktop) return null;
  return (
    <div className="window-controls">
      <button aria-label="Minimize" disabled={pinned} onClick={() => win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </button>
      <button aria-label="Maximize" disabled={pinned} onClick={() => win.toggleMaximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button aria-label="Close" className="close" onClick={() => win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}
