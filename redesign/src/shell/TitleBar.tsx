import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { appWindow, isDesktop, isMac } from "../../../src/lib/platform";
import { useRouter } from "../../../src/lib/router";
import { IconButton } from "../ui/Button";

/**
 * The strip along the top of the page: the window is dragged by it, Back sits at its left when there is somewhere
 * to go back to, and on Windows and Linux the window's own buttons sit at its right. It has no fill: the page shows
 * through it.
 */
export function TitleBar() {
  const { stack, back } = useRouter();
  const canGoBack = stack.length > 1;
  return (
    <header className="titlebar" data-tauri-drag-region>
      {canGoBack && <IconButton icon={ArrowLeftIcon} label="Back" className="titlebar-back" onClick={back} />}
      {isDesktop && !isMac && (
        <div className="window-buttons">
          <button aria-label="Minimize" onClick={() => appWindow.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 5h10" stroke="currentColor" />
            </svg>
          </button>
          <button aria-label="Maximize" onClick={() => appWindow.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          </button>
          <button aria-label="Close" className="window-close" onClick={() => appWindow.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
