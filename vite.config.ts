import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { pointScale } from "./scripts/pointScale";

/** The commit this build is made from, shown in Settings → About. "unknown" when git isn't available. */
function gitCommit() {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Preloads the default UI font (Polarity Sans, lib/settings/fonts.ts) so first paint never waits for CSS + React mount to discover it. */
function preloadPrimaryFont(): Plugin {
  return {
    name: "polar-preload-font",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => /PolaritySans-(Regular|Medium|SemiBold|Bold|ExtraBold).*\.woff2$/.test(f));
        if (!files.length) return html;
        const links = files.map((f) => `  <link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin>`).join("\n");
        return html.replace("</head>", `${links}\n  </head>`);
      },
    },
  };
}

// Tauri expects a fixed dev port and must see Rust compile errors in the terminal.
export default defineConfig({
  plugins: [react(), preloadPrimaryFont()],
  // px in our stylesheets is drawn in the desktop shell's points, so every rule scales with the window (scripts/pointScale.ts).
  css: { postcss: { plugins: [pointScale()] } },
  define: { __GIT_COMMIT__: JSON.stringify(gitCommit()) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|@tanstack)[\\/]/,
            },
            {
              name: "vendor-ui",
              test: /[\\/]node_modules[\\/](motion|framer-motion|@base-ui|lucide-react|@tauri-apps|country-flag-emoji-polyfill)[\\/]/,
            },
            {
              name: "app-lib",
              test: /[\\/]src[\\/]lib[\\/]((api|contract|errors|feedback|format|navTabs|parse|router|types|updateFeed|updater)\.tsx?$|net[\\/]|platform[\\/][^\\/]+\.ts$|theme[\\/]|ui[\\/]|settings[\\/](index|prefs|overlay|keybinds|fonts|episodeLayout|cropMode|pages|changes)\.ts$|account[\\/](index|AccountProvider|avatars|backend|accountFull|keyedLink|localSecrets|pin|pinTries|profileGuard|profileLock|profileRules|secrets|secretsNotice|settingsDoc|settingsSync|spacePush|sync|titleDisplay|tvSignIn|tvSignInLink|twoStep|unlock)\.tsx?$|catalog[\\/](index|shelves|browseFilter|listable|viewingLimit|ageRating|addonCatalogs|addonRows|genres|searchQuery)\.ts$|library[\\/](index|hiddenTitles|watched|identity|libraryEvents|playlists|playlistCodec|playlistChecklist|downloads|autoDownloads|keepDownloaded|episodes|episodeState)\.ts$|localFiles[\\/]|deepLink[\\/]|notifications[\\/])/,
            },
            {
              name: "app-ui",
              test: /[\\/]src[\\/](components[\\/](ui[\\/](Button|Chip|EmptyState|ErrorBoundary|Menu|Popover|Skeleton|Switch|TextField|Toast)\.tsx$|title[\\/](Card|LibraryButton|PlaylistChecklist)\.tsx$|anime[\\/]SeriesPickToast\.tsx$|profileLock[\\/](PinHost\.tsx|useGuard\.ts)$|(AccountFullToast|Avatar|BusyLabel|CardMenu|ConfirmDeleteButton|DeepLinks|HiddenTitleToast|ImdbBadge|Img|LockedKeysToast|NativeBack|OpenFiles|PlayerLayer|PosterCard|ProfileMenu|SecretsSyncToast|Sheet|SignOutDialog|Spinner|StoreProblemToast|SwapIcon|TitleLogo|Trailer|Updates|ViewStack|icons|profileSheetHost)\.tsx?$)|tv[\\/](tvMode|gamepad)\.tsx?$|screens[\\/](lazyScreens\.ts|homeFeed\.ts|account[\\/]profileHandoff\.ts)$)/,
            },
          ],
        },
      },
    },
  },
});
