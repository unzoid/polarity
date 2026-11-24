import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App, preloadActiveShell } from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { api } from "./lib/api";
import { keys, queryClient } from "./lib/net";
import { AccountProvider, startAccountBackend } from "./lib/account";
import { installKeepFieldInView, mirrorFormFactor } from "./lib/ui";
import { inShell, os } from "./lib/platform";

// Inter with weight + optical-size axes (Settings → Appearance → Font; files load when chosen).
import "@fontsource-variable/inter/opsz.css";
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
import "./styles/title/more-text.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/sheet.css";
import "./styles/party.css";
import "./styles/friends.css";
import "./styles/open-files.css";
import "./styles/import-playlist.css";
import "./styles/pin.css";
import "./styles/updates.css";
import { installGamepad } from "./tv/gamepad";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFont from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";

// Windows has no flag emoji: 🇬🇧 shows as the letters "GB". Where flags don't draw (checked on a
// canvas, so macOS, Linux and Android keep their own), a flags-only font is added, bundled with the
// app; its @font-face covers only the flag characters, so every other glyph keeps the app's font.
// Twemoji's flags, CC-BY 4.0; the polyfill MIT (docs/licensing.md).
// The check draws emoji on a canvas, about 15 ms on the way to the first frame, and its answer only changes
// with the web view: it's kept per user agent, and later starts add the same @font-face without checking.
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
  installGamepad();
  // Start fetching the active UI shell chunk right away in parallel with boot init so there is no waterfall,
  // without holding back root.render() (so theme application, account state and launch effects start immediately).
  void preloadActiveShell();
  await Promise.all([
    startAccountBackend().catch(() => undefined),
    queryClient.prefetchQuery({ queryKey: keys.settings, queryFn: api.settings }).catch(() => undefined),
  ]);
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
