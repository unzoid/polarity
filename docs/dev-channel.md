# The dev channel

Every change merged into `dev` builds installers of its own. Dev builds update from other dev builds
only, can go back to an earlier dev build, and never reach any of the project's databases unless
someone on the team connects them.

## Branches

- **`dev`:** day-to-day pull requests target it.
- **`master`:** moves when `dev` is merged into it for a release. Releases are tagged from it
  (`vX.Y.Z`, `.github/workflows/release.yml`), as before.
- **CI** (`ci.yml`) runs on every branch and pull request; the app end-to-end test (`e2e-app.yml`)
  also runs on pushes to `dev`.

## Three kinds of build

Which kind a build is comes from `VITE_POLAR_CHANNEL` at build time (`src/lib/platform/build.ts`):

| Build | Made by | Updates from | Settings → About says | Database |
|---|---|---|---|---|
| Release | `release.yml` on a `v*` tag, `scripts/release.ts`, `scripts/release-mac.ts` (`release`) | the newest release's `latest.json`, release key | `0.18.0` | built in (`VITE_SUPABASE_*`) |
| Dev | `dev-build.yml` on a push to `dev` (`dev`) | the "Dev build" pre-release's `latest.json`, dev key | `Dev build 3f9c2a1 (0.18.1-dev.57)` | none; a connection code (below) |
| Local | anything else: `bun tauri dev`, a build made by hand | never checks | `Local build 3f9c2a1` | whatever `.env` gives |

A release build is never offered a dev build and a dev build never a release: each checks only its
own feed, and each feed is signed with its own key.

## Dev builds (`.github/workflows/dev-build.yml`)

- **Trigger:** every push to `dev`. It builds what `release.yml` builds (Windows NSIS installer,
  macOS Apple Silicon app and DMG, Linux AppImage, `.deb` and `.rpm`) and the Android debug APK
  (arm64), which stays a workflow artifact. Windows has no MSI: an MSI's version can't carry `-dev.N`.
- **Version:** worked out at build time, never edited by hand (`scripts/devChannel.ts version`):
  the newest stable tag `vX.Y.Z` becomes `X.Y.(Z+1)-dev.N`, where `N` is the workflow's run number.
  After `v0.18.0` the builds are `0.18.1-dev.N`; after `v0.19.0` they become `0.19.1-dev.N` on
  their own. Every dev build sorts above the release it follows and below the next one
  (`tests/devChannel.test.ts`).
- **Name:** the short commit hash, as in "Dev build 3f9c2a1 (0.18.1-dev.57)", shown in the update
  prompt, Settings → About and the release entry.
- **Published in one rolling pre-release**, "Dev build" (tag `dev`), so the Releases list has a
  single dev line that never sits between releases and never becomes "Latest". Each build:
  - moves the `dev` tag to its commit;
  - uploads its files with the build number in the name (`polarity-dev.57-Windows-x64-setup.exe`,
    `polarity-dev.57-macOS-arm64.dmg`, `polarity-dev.57-Linux-x64.AppImage`…, with the mpv source
    archives for Windows and macOS, docs/licensing.md) and its own feed `latest-dev.57.json`;
  - replaces the channel's `latest.json`, which offers this build and lists every kept one;
  - removes the files of builds older than the newest 11 (this one and the previous 10);
  - rewrites the entry's notes: hash, build number, date, the merged pull request's title, and
    the kept builds.

## Its own app

A dev build installs and runs as an app of its own next to the released Polarity, never over it
(`devConf` in `scripts/devChannel.ts`, `src-tauri/src/dev_channel.rs`, `src/lib/platform/build.ts`):

- **Name:** "Polarity Dev" in the Start menu, the Applications folder and the taskbar; its program
  and package are `polarity-dev`, its release files `polarity-dev.N-…`.
- **Identifier:** `app.getpolar.desktop.dev`, so its own install folder, app data and settings,
  keychain entries and notifications. The released app's data is never touched; a dev build starts
  empty and signed out.
- **Links:** `polarity-dev://…`; it doesn't take `polarity://` links, which stay the released app's.
  The website's pages open `polarity://`, so they reach the released app.
- **Single instance:** its own lock (the single-instance plugin keys it on the identifier), so a
  second launch or a link reaches the right app.
- **Window title:** "Polarity Dev", and Settings → About is headed "Polarity Dev". The icon is the
  released one.
- **Updates:** its own line, from the "Dev build" entry only (above).
- **Android:** the APK keeps the released app's id for now (its Java classes are named by it), so it
  doesn't install next to a release build there.

## Going back

In a dev build, Settings → About → Earlier builds lists the kept builds (hash, version, date and the
pull request each came from), each with **Install this build**. The build downloads like an update,
older ones included (`src-tauri/src/dev_channel.rs` reads that build's own feed and skips the
version check; the signature is still checked against the dev key), and waits for **Restart to
Update**.

After that the next check offers the newest dev build again. To stay on the older one, turn on
**Pause updates** on the same screen: no newer build is offered on its own until it's off, and
**Check for Updates** still looks.

## Databases

An experimental build that someone outside the team uses must not reach any of the project's
databases, neither production nor development.

- **Nothing built in:** `dev-build.yml` sets no `VITE_SUPABASE_*`, and a dev build ignores them
  even if they were set. Out of the box it works signed out, and says so where you'd sign in (the
  profile menu and the Settings sidebar).
- **Connecting:** Settings → Advanced → Database, in dev builds only, takes a connection code. It
  holds the database's address and publishable key, is kept in the device's keychain
  (`polar.devdb`), can be removed, and the screen says which database the build is on. A change
  takes effect when Polarity starts again; the session on the previous database is dropped.
  Secret and service-role keys are refused.
- **Making a code** (whoever owns the dev project), shared with the team privately:

  ```
  bun scripts/devDatabaseCode.ts https://<project>.supabase.co <publishable key>
  ```

- **Release builds** are unchanged and have no such setting.
- **CI's builds:** once `ci.yml` gives the Android and iOS builds the production settings
  (`VITE_SUPABASE_*` secrets), only builds of `master` should get them; builds of other branches,
  `dev` included, get none.
- **What the app can't enforce:** a publishable key works from any app that has it, and
  production's is in every release build. The protection is in the databases: on the dev database,
  sign-ups closed and invited accounts only; on production, the row-level security it has.

### Preparing the dev database

Run by whoever owns the dev Supabase project, with the Supabase CLI:

1. **Close sign-ups:** Dashboard → Authentication → Sign In / Providers → turn off "Allow new users
   to sign up". Email sign-in stays on: invited accounts sign in with a code as usual, and an email
   that wasn't invited is told so.
2. **Invite accounts:** Authentication → Users → Add user → Send invitation, one per teammate.
3. **Sign-in email:** Authentication → Emails → "Magic Link" and "Confirm signup": paste `supabase/email-templates/code.html`
   (the app signs in with the six-digit code, not a link).
4. **Apply the migrations:** `supabase link --project-ref <project>`, then `supabase db push`
   (everything in `supabase/migrations`, in order). `supabase/optional/` stays optional, as on production.
5. **Deploy the Edge Function** for TV sign-in: `supabase functions deploy tv-sign-in --no-verify-jwt`
   (docs/supabase-storage.md §9).
6. **Make the connection code** (above) and share it privately.

## What the owner sets up

1. Merge the pull request that adds this.
2. Make the dev updater key pair: `bun tauri signer generate -w dev-updater.key` (with a password).
   Never commit it. Then in Settings → Secrets and variables → Actions:
   - secret `DEV_UPDATER_PRIVATE_KEY`: the contents of `dev-updater.key`;
   - secret `DEV_UPDATER_PRIVATE_KEY_PASSWORD`: its password;
   - variable `DEV_UPDATER_PUBLIC_KEY`: the contents of `dev-updater.key.pub`.
   Without them the workflow stops at its first step and says which is missing.
3. Create the `dev` branch from `master` if it isn't there yet.
4. Optionally, Settings → General → Pull Requests → "Automatically delete head branches".

## Checks on GitHub

These can only be seen on GitHub and a real install (docs/unverified.md):

- a push to `dev` makes the "Dev build" pre-release named by its hash, with installers, and a running
  dev build updates to it;
- a dev build installs an older kept build from About, then updates forward again (with Pause
  updates off);
- a fresh dev build has no database, and connects after a code is pasted and Polarity restarts;
- a local build doesn't offer any update;
- the released Polarity and a dev build installed side by side on Windows: each updates only from
  its own line, keeps its own settings, and opens only its own links (`polarity://`,
  `polarity-dev://`);
- the Releases list has one "Dev build" entry, never "Latest";
- after the 12th build, the oldest build's files are gone from the entry.
