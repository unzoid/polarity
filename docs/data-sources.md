# External data sources

What Polarity asks other services for, where in the code, what it needs from the user, and the
limits it works within. The owner decides which sources the app uses; a new endpoint is added here
first (see `AGENTS.md`).

## 1. Sources in use

| Source | Used for | Code | Key | Limits the app works within |
|---|---|---|---|---|
| TMDB API v3 | Catalog, search, metadata, episodes, recommendations, images, IMDb id lookup, trailers (YouTube ids), logos, age ratings (`release_dates`, `content_ratings` appended to the details requests already made; discover's `certification_country`/`certification.lte` for a profile's age limit) | `crates/index/src/tmdb.rs` | The user's own | About 40 requests a second; 429 answered with a back-off |
| TMDB API v3 | Catalog, search, metadata, episodes, recommendations, images, IMDb id lookup, trailers (YouTube ids), logos, a show's other episode orders (episode groups: `/tv/{id}/episode_groups`, `/tv/episode_group/{id}`) | `crates/index/src/tmdb.rs`, `crates/index/src/tmdb/orders.rs` | The user's own | About 40 requests a second; 429 answered with a back-off |
| TMDB API v3 | Catalog, search, metadata, episodes, recommendations, images, IMDb id lookup, trailers and a title's other videos (YouTube ids), logos, people's pages (`/person/{id}` with `combined_credits`) | `crates/index/src/tmdb.rs`, `crates/index/src/tmdb/people.rs` | The user's own | About 40 requests a second; 429 answered with a back-off |
| TMDB API v3 | "More like this": `/{tv,movie}/{id}/recommendations` (two pages); details with `keywords,credits` appended; `/discover` by one keyword and by a set of genres (most voted first); a creator's or director's `/person/{id}/tv_credits` or `movie_credits`; `/collection/{id}`; a search for a title's sequels and spin-offs | `crates/index/src/tmdb/recs.rs`, ranked by `crates/index/src/similar.rs` | The user's own | Up to about 80 requests for a title's first row (46 details, 24 keyword lists, the rest one each), many shared with other titles' rows through day-long caches |
| Cinemeta | Catalog, search and metadata when there is no TMDB key; IMDb ids for anime ani.zip can't link | `crates/index/src/cinemeta.rs`, `src/lib/anime/search.ts` | None | None published |
| metahub images | Posters, backgrounds, logos and episode stills for IMDb ids | `cinemeta.rs`, `src/lib/account/titleDisplay.ts`, `src/lib/anime/landscapeArt.ts` | None | None published |
| IMDb GraphQL | Trailers as video files; each episode's IMDb rating for Episode Ratings (the owner's decision, 15/11/2026: TMDB's per-episode scores were too few and ran low), TMDB's kept for a show IMDb rates none of | `src-tauri/src/imdb.rs`, `trailers.rs`, `episode_ratings.rs` | None | Trailer links expire after about a day; episode ratings are cached 12 h per show, at most 5 pages of 250 episodes |
| IMDb suggestion | Cast photo when the catalog has none | `src/lib/catalog/personPhoto.ts` | None | None published |
| MDBList | Scores from several sites, certification | `src-tauri/src/ratings.rs` | The user's own | 1,000 a day on the free tier, cached 6 h |
| OMDb | Scores, awards, rating | `ratings.rs` | The user's own | 1,000 a day on the free tier |
| AniList GraphQL | Anime catalog, seasons, schedule, relations, characters, search | `src/lib/anime/anilist.ts`, `src/lib/net/limiter.ts` | None | 90 a minute (30 while degraded); a 429 means a minute's wait. Requests wait in one queue, most urgent first (an opened page, then rows on screen); single entries asked within a moment go in one request (`lib/anime/batch.ts`); rows, pages and franchise links are kept on the device up to a day, the airing schedule and airing entries' pages an hour |
| AniList account | The profile's AniList list: watched episodes, status and score from an anime's page, and the list import in Settings → Services | `src/lib/lists/`, `src/screens/settings/ServicesPage.tsx`, `src/components/anime/AnimeListPanel.tsx` | The user's own sign-in, made on AniList's page for Polarity's API client (not registered yet: the sign-in says it isn't set up) | The catalog's budget. Changes wait in a queue per profile and go out together; entries changed on AniList are read on start, 50 at most |
| MyAnimeList account | The profile's MyAnimeList list: watched episodes, status and score from an anime's page, and the list import in Settings → Services | `src/lib/lists/malList.ts`, `malSignIn.ts`, `src-tauri/src/mal.rs` | The user's own sign-in (OAuth with PKCE, no client secret) through Polarity's MyAnimeList API client, whose id the release build is given as `VITE_MAL_CLIENT_ID` (none yet: the sign-in says it isn't set up). Requests go through the app's native side, which lets only the list paths through | None published; MAL answers 403 when it thinks it is flooded, which waits like a 429. Changes wait in a queue per profile; entries changed on MAL are read on start, 50 at most |
| Trakt account | The profile's Trakt history (scrobbling while playing, watched marks both ways), watchlist (kept in step with the library when switched on), film and show ratings from a title page, and the import in Settings → Services | `src/lib/trakt/`, `src/screens/settings/ServicesPage.tsx`, `src/components/settings/TraktSignIn.tsx`, `TraktImport.tsx`, `src/components/title/TraktRating.tsx`, `src/components/player/useTraktScrobble.ts` | The user's own sign-in (device code entered on Trakt's site; no client secret is sent) through Polarity's Trakt API app, whose client id the release build is given as `VITE_TRAKT_CLIENT_ID` (none yet: the sign-in says it isn't set up) | 500 reads per 5 minutes per user, of which Polarity uses at most 90 a minute; 1 write a second. A 429 waits for its Retry-After once. Watched marks and watchlist changes wait in a queue per profile and go out in batches; what changed on Trakt is read after its `last_activities`, on start and when the window comes back at most every few minutes |
| Simkl account | The profile's Simkl lists (films, shows and anime): scrobbling while playing, watched marks both ways, Plan to Watch kept in step with the library when switched on, the list and a 1 to 10 rating from a title page, and the import in Settings → Services | `src/lib/simkl/`, `src/screens/settings/ServicesPage.tsx`, `src/components/settings/SimklSignIn.tsx`, `SimklImport.tsx`, `src/components/title/SimklPanel.tsx`, `src/components/player/useSimklScrobble.ts` | The user's own sign-in (PIN entered on Simkl's site; no client secret is sent) through Polarity's Simkl API app, whose client id the release build is given as `VITE_SIMKL_CLIENT_ID` (none yet: the sign-in says it isn't set up). Every request carries `client_id`, `app-name` and `app-version` | A daily allowance per account (`X-RateLimit-Remaining`); one request at a time. A spent allowance stops requests until its Retry-After, and background reads stop while fewer than 50 are left. What changed on Simkl is read after `/sync/activities`, only for the kinds that moved, on start and when the window comes back at most every 15 minutes. Changes wait in a queue per profile and go out in batches |
| Jikan | Filler and recap episodes | `crates/anime/src/fillers.rs` | None | 60 a minute, 3 a second; 400 ms between pages |
| animefillerlist.com | Filler episodes when Jikan knows none | `crates/anime/src/fillers.rs` | None | One page per show, cached 24 h |
| ani.zip | Ids across anime and general sources, per-episode data, art | `src/lib/anime/anizip.ts` | None | None published |
| Fribb/anime-lists | The same ids when ani.zip can't be reached | `crates/anime/src/anime_lists.rs` | None | One file from GitHub, refreshed weekly |
| AniSkip | Opening, ending and recap times for anime | `src/lib/anime/aniskip.ts` | None | None published |
| IntroDB | Intro, recap and credits times by IMDb id | `src-tauri/src/introdb.rs` | None for reads | Rate limited, numbers not published |
| Seekr | Seek-bar thumbnails | `src-tauri/src/seekr.rs` | The user's own | Per key |
| YouTube (nocookie embed) | Trailers in the trailer player when there is no video file; a YouTube link put on in a watch party (Watch a Link), driven through the embed's IFrame Player API messages | `src/components/Trailer.tsx`, `src/components/player/youtubeMedia.ts` | None | — |
| OpenSubtitles v3 add-on | Subtitles, installed by default | `src-tauri/src/lib.rs` | None | — |
| Add-ons the user installs | Streams, subtitles, catalogs | `crates/addon/src/client.rs`, `src-tauri/src/commands.rs` | Per add-on | Each add-on's own |
| Add-on list | The curated list in Settings → Add-ons | `src/lib/catalog/marketplace.ts` | None | — |
| GitHub releases API | Release notes for updates | `src/lib/updater.ts` | None | 60 unauthenticated requests an hour |
| Letterboxd export (a file) | Watchlist and watched films the user imports (#87) | `src/lib/library/letterboxdImport.ts`, `src/components/settings/LetterboxdImport.tsx` | None | Read on the device; nothing is fetched from Letterboxd and its `boxd.it` links are never followed. Films are found through the catalog above, two searches at a time |
| Supabase | Accounts and sync, the owner's project | `src/lib/account/` | Owner's publishable key | `docs/supabase-storage.md` |

Every host the web view fetches from is listed in its `connect-src` policy
(`src-tauri/tauri.conf.json`, checked by `tests/webviewPolicy.test.ts`).

## 2. Decisions

- **Catalog:** TMDB when the user enters a key, Cinemeta otherwise. Keys are the user's own; the app ships none.
- **Trailers:** TMDB's first with a key, then IMDb's video file, then an add-on's or AniList's YouTube trailer. The
  backdrop behind a title's page plays video files only, never a YouTube embed. A title's other TMDB videos (YouTube
  only) are its Extras, played in the same trailer player; their tiles show YouTube's still (`i.ytimg.com`, already
  allowed by `img-src`), or the name and kind when it doesn't load.
- **People:** only with a TMDB key, which names cast and crew by id. A person's page is one `/person/{id}` request with
  `combined_credits`; at most 45 of their titles are kept and looked up for IMDb ids through the same day-long cache as
  list results, six at a time. Cinemeta's names have no ids and stay plain text.
- **More like this:** with a TMDB key, candidates from TMDB's recommendations, the seed's keywords, its creators' (a
  film's directors' and writers') other work, its franchise and its genres, ranked on the device by shared keywords
  (weighted by how few titles carry them), people, genres and a little rating (`crates/index/src/similar.rs`). TMDB's
  `/similar` isn't used: its lists were mostly unrelated titles. Without a key, Cinemeta's popularity lists are ranked by
  their plot summaries' shared words and genres, with the franchise (found by a search for the title's name) first.
- **Fillers:** Jikan first, animefillerlist.com when Jikan knows none, answers cached 24 h on disk.
- **Anime ids:** ani.zip first; Fribb/anime-lists, downloaded when first needed and refreshed weekly, when it can't be
  reached. The list is fetched at runtime, not shipped with the app.
- **AniList account:** the sign-in and the entries read from the list stay on the device (the system's keychain, else the
  web view's storage) and are never sent to Polarity's database; each device and profile signs in itself. Unlinking
  removes the sign-in, the queued changes and the entries kept from the list.
- **MyAnimeList account:** as with AniList, the sign-in and the entries read from the list stay on the device and are
  never sent to Polarity's database. The client id isn't in the source: the release build gets it from
  `VITE_MAL_CLIENT_ID`, and a build without one hides the sign-in. The tokens are refreshed before they run out, so a
  profile signs in again only after a month without opening Polarity. The row and the anime page say "Uses the
  MyAnimeList API".
- **Trakt account:** the sign-in stays on the device (the system's keychain, else the web view's storage) and is never
  sent to Polarity's database; each device and profile signs in itself. Trakt's CORS answers the web view, so requests
  go straight to `api.trakt.tv` (listed in `connect-src`). The client id isn't in the source: the release build gets it
  from `VITE_TRAKT_CLIENT_ID`, and a build without one says the sign-in isn't set up. Only titles with an IMDb id are
  sent; anime played from Kitsu ids say on their page that they aren't. What is removed on Trakt (a play, a watchlist
  title) isn't followed. The row and the credits carry Trakt's line "Polarity is not endorsed or certified by Trakt."
  Unlinking revokes the token and removes the sign-in, the queue, the ratings kept and the last look.
- **Simkl account:** the sign-in stays on the device (the system's keychain, else the web view's storage) and is never
  sent to Polarity's database; each device and profile signs in itself. Simkl's CORS answers the web view, so requests
  go straight to `api.simkl.com` (listed in `connect-src`). The client id isn't in the source: the release build gets it
  from `VITE_SIMKL_CLIENT_ID`, and a build without one says the sign-in isn't set up. Films and shows are sent by their
  IMDb id and anime played from Kitsu ids by their Kitsu number; titles with neither aren't sent. A Kitsu account link
  isn't offered: Kitsu's API signs a user in only by sending their Kitsu password through the app. Removals on Simkl
  aren't followed into Polarity; removing a title on its page takes it off every Simkl list and its watched history,
  as Simkl does. The credits say "uses the Simkl API" in text; Simkl's API rules ask for its logo; the owner decided it
  is shown (Simple Icons mark) on the Settings → Services row, and Simkl's own monochrome mark sits in a title
  page's "View on Simkl" link (#319, credited in docs/licensing.md). Unlinking revokes the token and removes the sign-in, the queue, the
  lists and ratings kept and the last look.
- **Letterboxd:** its API is by invitation only, so there is no account link. The import reads the export the user
  downloads from Letterboxd's settings. The export carries no IMDb or TMDB ids, so each film is matched by title and year
  through the catalog (TMDB's search narrowed to the year, Cinemeta's plain search). A row that matches no film, or more
  than one, is left for the user to pick. Ratings aren't imported: Polarity has no rating of its own.
- **Credits:** Settings → About → Credits names every source and shows TMDB's notice and logo (`src/lib/settings/credits.ts`).

## 3. What the app keeps on disk

Filler answers and the anime id list are in the app's cache folder:

| Platform | Folder |
|---|---|
| Linux | `$XDG_CACHE_HOME/app.getpolar.desktop/` (`~/.cache/app.getpolar.desktop/` when unset) |
| macOS | `~/Library/Caches/app.getpolar.desktop/` |
| Windows | `%LOCALAPPDATA%\app.getpolar.desktop\` |

- `fillers.json`: per MyAnimeList id, when it was fetched, filler and recap episode numbers and which site answered.
  Used for 24 h, kept up to 30 days as a fallback, at most 500 shows. Nothing about the user.
- `anime-list-mini.json`: the Fribb/anime-lists file (about 6 MB).
- Settings → About → Cache shows the folder and clears both files.
