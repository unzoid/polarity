import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

/** The commit this build is made from, shown in Settings → About. "unknown" when git isn't available. */
function gitCommit() {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Preloads the primary Latin variable UI font so first paint never waits for CSS + React mount to discover it. */
function preloadPrimaryFont(): Plugin {
  return {
    name: "polar-preload-font",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const fileName = Object.keys(ctx.bundle ?? {}).find((f) => /inter-latin-opsz-normal.*\.woff2$/.test(f));
        if (!fileName) return html;
        return html.replace(
          "</head>",
          `  <link rel="preload" as="font" type="font/woff2" href="/${fileName}" crossorigin>\n  </head>`,
        );
      },
    },
  };
}

// Tauri expects a fixed dev port and must see Rust compile errors in the terminal.
export default defineConfig({
  plugins: [react(), preloadPrimaryFont()],
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
              test: /[\\/]src[\\/]lib[\\/](?!(account[\\/](supabase|devDatabase)|settings[\\/](schema|searchIndex)|platform[\\/]fake))/,
            },
            {
              name: "app-ui",
              test: /[\\/]src[\\/](components[\\/](?!(SettingsOverlay|avatarArt|player|downloads|anime[\\/](AnimeCharacters|AnimeDetails|AnimeEpisodes|AnimeHero|AnimeListPanel|AnimeRelated|FilmCard)|title[\\/](EpisodeCard|EpisodeOrderPicker|EpisodeShelf|ExtrasShelf|NameList|SeasonActions|SeasonPicker|SimklPanel|SourcePicker|TitleActions|TitleDetails)|friends[\\/]FriendsPanel|party[\\/]PartyMenu|profileLock[\\/](PinFlow|ProfileLockRows|LimitFromProfile|AccountCheck)|settings|ProfileEditSheet|StillPlaceholder|SliderField|StreamList|SourceFilters|SourceInfo|Segmented|RatingRing|BackdropTrailer))|tv[\\/](tvMode|gamepad|TvChrome)|screens[\\/](Home\.tsx|lazyScreens\.ts|account[\\/]profileHandoff))/,
            },
          ],
        },
      },
    },
  },
});
