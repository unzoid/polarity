import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { api } from "./lib/api";
import { keys, queryClient } from "./lib/net";
import { AccountProvider, startAccountBackend } from "./lib/account";
import { installKeepFieldInView, mirrorFormFactor, whenIdle } from "./lib/ui";
import { inShell, os } from "./lib/platform";

// Inter with weight + optical-size axes: large titles get the Display cut automatically.
import "@fontsource-variable/inter/opsz.css";
// The other app fonts (Settings → Appearance → Font): only @font-face rules here; a font's files load when it's chosen.
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource-variable/onest/wght.css";
import "@fontsource-variable/mona-sans/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui/button.css";
import "./styles/ui/chip.css";
import "./styles/ui/switch.css";
import "./styles/ui/search-field.css";
import "./styles/ui/text-field.css";
import "./styles/ui/empty-state.css";
import "./styles/ui/skeleton.css";
import "./styles/ui/toast.css";
import "./styles/ui/menu.css";
import "./styles/ui/layer.css";
import "./styles/title/poster-grid.css";
import "./styles/title/playlist-checklist.css";
import "./styles/title/episode-ratings.css";
import "./styles/title/more-text.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/detail.css";
import "./styles/sheet.css";
import "./styles/party.css";
import "./styles/friends.css";
import "./styles/open-files.css";
import "./styles/screens.css";
import "./styles/account.css";
import "./styles/pin.css";
import "./styles/anime.css";
import "./styles/tv.css";
import "./styles/updates.css";
import "./styles/phone.css";
import { installGamepad } from "./tv/gamepad";

// Windows has no flag emoji: 🇬🇧 shows as the letters "GB". Where flags don't draw (checked on a
// canvas, so macOS, Linux and Android keep their own), a flags-only font is added, bundled with the
// app; dynamically imported on Windows only so mobile bundles skip evaluating the polyfill at cold start.
if (os === "windows") {
  const FLAG_FONT = "Twemoji Country Flags";
  const key = "polar.flagFont";
  const ua = navigator.userAgent;
  let known: string | null = null;
  try {
    known = localStorage.getItem(key);
  } catch {
    /* storage unavailable: check every time */
  }
  void Promise.all([
    import("country-flag-emoji-polyfill"),
    import("country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url"),
  ]).then(([{ polyfillCountryFlagEmojis }, { default: flagFont }]) => {
    if (known === `1|${ua}`) {
      const style = document.createElement("style");
      // As the polyfill adds it: the flag characters only.
      style.textContent = `@font-face { font-family: "${FLAG_FONT}"; unicode-range: U+1F1E6-1F1FF, U+1F3F4, U+E0062-E0063, U+E0065, U+E0067, U+E006C, U+E006E, U+E0073-E0074, U+E0077, U+E007F; src: url('${flagFont}') format('woff2'); font-display: swap; }`;
      document.head.append(style);
    } else if (known !== `0|${ua}`) {
      const added = polyfillCountryFlagEmojis(FLAG_FONT, flagFont);
      try {
        localStorage.setItem(key, `${added ? 1 : 0}|${ua}`);
      } catch {
        /* checked again next time */
      }
    }
  });
}

// Font rendering differs by OS; base.css tunes text weight for Windows.
// "mac" also makes room for the traffic lights (shell.css).
document.documentElement.dataset.os = os === "windows" ? "windows" : os === "macos" ? "mac" : os === "android" ? "android" : "other";
// Chromium's web views (WebView2, Android's) skip drawing shelves out of view (cards.css, #134); WebKit's
// scrollIntoView doesn't reach into them, so it keeps drawing them. Only Chromium has userAgentData.
if ("userAgentData" in navigator) document.documentElement.dataset.engine = "chromium";
// Phone, tablet or desktop, and touch: the shell and target sizes follow (lib/platform/formFactor.ts).
mirrorFormFactor(document.documentElement);
// Phones and tablets: the on-screen keyboard never covers the field it types into.
installKeepFieldInView();

const root = createRoot(document.getElementById("root")!);

if (!inShell) {
  root.render(
    <div className="not-tauri">
      <p className="t-title2">Polarity runs inside its desktop shell.</p>
      <p className="muted t-body">
        Start it with <code>bun run app</code>.
      </p>
    </div>,
  );
} else {
  // Defer gamepad listener setup past first paint; start account backend in parallel without blocking root.render().
  whenIdle(installGamepad, 1500);
  void startAccountBackend().catch(() => undefined);
  // Warm stored settings (~5 ms local IPC) so App() applies theme, scheme, font and motion on frame 0.
  await queryClient.prefetchQuery({ queryKey: keys.settings, queryFn: api.settings }).catch(() => undefined);
  root.render(
    <StrictMode>
      <ErrorBoundary where="app">
        <QueryClientProvider client={queryClient}>
          <AccountProvider>
            <App />
          </AccountProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
